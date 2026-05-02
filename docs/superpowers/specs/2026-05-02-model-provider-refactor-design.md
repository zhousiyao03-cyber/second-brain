# Model Provider 接入重构 — Design

**Date**: 2026-05-02
**Status**: Approved (brainstorming complete, awaiting plan)
**Branch**: `feat/model-provider-refactor` (to be created)

## 1. 背景与动机

knosi 当前的 AI provider 接入散落在 9+ 处代码：`types.ts` 的 `AIProviderMode` 枚举、`mode.ts` 的 env 解析、`ai-sdk.ts` 的 provider 工厂 + 默认 model 常量、`identity.ts` 的身份字符串、`provider/index.ts` 的两个 dispatcher、Settings 页面的 `OPTIONS` 数组、`ModelPicker` 的 `PRESET_MODELS`、schema enum、`council/persona-stream.ts` 自己读 `OPENAI_API_KEY`、`embeddings.ts` 自己读 env。

实际暴露的问题：

1. **6 个 provider 选项**（`local` / `openai` / `codex` / `claude-code-daemon` / `cursor` / `knosi-hosted`）UI 上让用户晕，配完经常出 bug。
2. **想接入 DeepSeek / 任意 OpenAI-compatible API 没法做**——必须改代码加分支。
3. **配置源混乱**：env 变量 + `users` 表两列 + `~/.openclaw/...` JSON 文件，三处共同决定路由。
4. **能力 / model / provider 关系不透明**：tool-calling 仅 AI SDK 路径支持，codex/daemon 静默丢弃 `tools`；embedding / council 完全绕过 façade。
5. **`identity.ts` 故意忽略用户偏好**（注释里都坦白了），导致 AI 自我介绍和实际路由不一致。
6. **Pro / hosted 概念用户用不上**——线上只有自己一个用户。

## 2. 目标

- 用户视角：Settings 中能清楚看到「我配置了哪些 backend」+「每个 AI 功能用哪个 backend / model」。
- 配完即用：可以当场点「Test」验证连通性，不再"配完再去 Ask AI 报错才发现错"。
- 加新 OpenAI-compatible 服务（DeepSeek / Moonshot / SiliconFlow / 自定义代理）零代码改动。
- 代码侧：feature → role → provider 的映射显式、单一信源。
- 砍掉用不上的概念：`knosi-hosted` / `codex` / `cursor` 三个 provider 整体删除；env 作为 provider 配置入口废弃。

## 3. 范围

### 3.1 In scope

- 数据模型重构：新增 `ai_providers` + `ai_role_assignments` 两张表；drop `users.ai_provider_preference` / `users.ai_chat_model`。
- API key 加密存储（AES-256-GCM，单 master key 来自 `KNOSI_SECRET_KEY` env）。
- 新 Settings UI：Providers 段 + AI Roles 段（Chat / Task / Embedding）。
- 重写 provider façade：统一入口 `resolveAiCall(role, userId)`，所有 caller 显式传 role。
- 删 `codex` / `cursor` / `hosted` 三套 backend 实现 + 相关 env / billing 耦合。
- 让 `identity.ts` 终于和实际路由一致（async + userId）。
- 现有 caller（Ask AI / Council / Drifter / 标签摘要 / RAG indexer）一次性切到新 façade。
- 生产 Turso schema rollout + changelog 记录。

### 3.2 Out of scope

- 密钥轮换 / dual-key rotation —— 单人小项目，丢失 secret 时清空 `api_key_enc` 让用户重填即可。
- 多用户在同一个 deployment 共享 provider —— 每个 user 维护自己的 providers。
- Per-Council-persona 单独 model —— 全部 persona 共用 `chat` role。
- 多 chat assistant 切换 —— 一个 chat role assignment 全局生效。
- BYO embedding 自定义维度 —— 沿用现有 OpenAI embedding 维度。
- 任何针对 hosted/billing 的迁移 —— 直接删，不做兼容。

## 4. 设计

### 4.1 数据模型

新增表 `ai_providers`：

```ts
ai_providers (
  id           text primary key,           // crypto.randomUUID()
  user_id      text not null references users(id) on delete cascade,
  kind         text not null,              // 'openai-compatible' | 'local' | 'claude-code-daemon'
  label        text not null,              // 用户起的名字，如 "OpenAI" / "DeepSeek" / "Home Ollama"
  base_url     text,                       // openai-compatible / local 用；daemon 为 null
  api_key_enc  text,                       // AES-256-GCM 加密；local / daemon 为 null
  created_at   integer not null,
  updated_at   integer not null,
)

index ai_providers_user_idx on ai_providers (user_id)
```

新增表 `ai_role_assignments`：

```ts
ai_role_assignments (
  user_id     text not null references users(id) on delete cascade,
  role        text not null,               // 'chat' | 'task' | 'embedding'
  provider_id text not null references ai_providers(id) on delete restrict,
  model_id    text not null,               // 'gpt-4o' / 'deepseek-chat' / 'opus' / 'qwen2.5:14b' ...
  updated_at  integer not null,
  primary key (user_id, role)
)
```

`on delete restrict`：删除一个被 role 引用的 provider 必须先解除引用（UI 弹确认对话框）。

字段语义：

- `kind` 决定 UI 表单和 runtime 路由分支。
- `label` 仅展示用，可用户重命名（同一种 kind 可有多条，例如两把 OpenAI key）。
- `api_key_enc` 用 `KNOSI_SECRET_KEY` 派生密钥解密（详见 §4.2）。
- 约束：`role = 'embedding'` 的 provider 不能是 `kind = 'claude-code-daemon'`（schema 校验 + runtime 兜底）。

Drop 列（drizzle migration）：
- `users.ai_provider_preference`
- `users.ai_chat_model`

### 4.2 加密

- **算法**：AES-256-GCM
- **密钥**：`KNOSI_SECRET_KEY` env，32 字节随机值（用户 `openssl rand -hex 32` 生成）
  - 启动校验：缺失 / 长度错 → `throw`，进程退出
  - 生产部署：通过 GitHub Actions secret 注入到 Hetzner k8s secret
- **每行 IV**：加密时 `crypto.randomBytes(12)`
- **存储格式**：单字段 `api_key_enc = base64(iv || ciphertext || authTag)`
- **实现位置**：`src/server/ai/crypto.ts`
  - `encryptApiKey(plain: string): string`
  - `decryptApiKey(enc: string): string`
- **错误处理**：解密失败（如 secret 换过 / 密文损坏）抛 `ApiKeyDecryptionError`；UI 显示「This provider's key cannot be decrypted, please re-enter」。

**前端隔离**：tRPC `listProviders` 返回 `{ id, kind, label, baseUrl, hasApiKey: boolean }`，**绝不**回传 plaintext / 脱敏 key。编辑 provider 时，key 字段留空 = 保留旧值；填了 = 整把覆盖。

**日志**：所有 logger 调用绝不打印 plaintext key 或 ciphertext。

### 4.3 Runtime façade

`src/server/ai/provider/` 重写后的核心：

```ts
type ResolvedProvider =
  | { kind: 'openai-compatible'; baseURL: string; apiKey: string; modelId: string; providerId: string }
  | { kind: 'local';             baseURL: string; modelId: string; providerId: string }
  | { kind: 'claude-code-daemon'; modelId: string; providerId: string };

async function resolveAiCall(
  role: 'chat' | 'task' | 'embedding',
  userId: string,
): Promise<ResolvedProvider>
```

实现步骤：

1. 查 `ai_role_assignments` by `(userId, role)`，没配 → throw `MissingAiRoleError(role)`（UI 引导跳转 Settings）。
2. 查 `ai_providers` by `provider_id` 拿 `(kind, base_url, api_key_enc)`。
3. 解密 `api_key_enc`（如果有）。
4. 返回 `ResolvedProvider`。

公共 caller 入口收敛到 3 个：

```ts
streamChat(options, { userId, role: 'chat' | 'task' = 'chat' }):    Promise<{ response: Response; modelId: string | null }>
generateStructured(options, { userId, role: 'chat' | 'task' = 'task' }): Promise<T>
generateEmbeddings(texts, { userId }):                               Promise<number[][]>
```

内部分支：

- `openai-compatible` / `local` → `createOpenAI({ baseURL, apiKey })` → Vercel AI SDK 一条共用路径。
- `claude-code-daemon` → 现有 daemon 队列代码（`daemon.ts` 保留）。
- `embedding` role 仅允许 `kind ∈ { openai-compatible, local }`（schema 阻止 + runtime 兜底）。

**身份字符串重构**：`getChatAssistantIdentity(userId)` 改 async，从 chat role 解析出 provider label + model id，文案与实际路由一致。`identity.ts` 现有的"故意忽略用户偏好"让步可以撤销。

### 4.4 Settings UI

两段卡片，纵向排列。

#### 4.4.1 Providers 段

```
┌─ Providers ──────────────────────────────────────────┐
│  [OpenAI]                          openai-compatible │
│  api.openai.com/v1     sk-...****     [Test] [Edit] │
│                                                       │
│  [DeepSeek]                        openai-compatible │
│  api.deepseek.com/v1   sk-...****     [Test] [Edit] │
│                                                       │
│  [Home Ollama]                                local │
│  127.0.0.1:11434/v1                   [Test] [Edit] │
│                                                       │
│  [Claude Code CLI]               claude-code-daemon │
│                                       [Test] [Edit] │
│                                                       │
│  [+ Add Provider]                                     │
└──────────────────────────────────────────────────────┘
```

`Test` 按钮：
- openai-compatible / local → `GET {baseURL}/models`，2xx = 通；非 2xx / network error → 显示错误信息。
- daemon → 调 daemon 健康检查（现有 `daemon-mode.ts` 提供的 health 接口）。

`Edit` 弹窗按 kind 渲染不同表单（见 §4.4.3）。

#### 4.4.2 AI Roles 段

```
┌─ AI Roles ───────────────────────────────────────────┐
│  Chat        [DeepSeek ▾]    [deepseek-chat ▾]      │
│              Used by Ask AI, Council, Drifter         │
│                                                       │
│  Task        [OpenAI ▾]      [gpt-4o-mini ▾]        │
│              Used by tag/summary auto-generation      │
│                                                       │
│  Embedding   [OpenAI ▾]      [text-embedding-3 ▾]   │
│              Used by RAG indexing                     │
│              ⚠ Claude CLI not available for this role │
└──────────────────────────────────────────────────────┘
```

Provider 下拉：
- Chat / Task：列出当前 user 所有 providers。
- Embedding：列出 `kind ∈ { openai-compatible, local }` 的 providers。

Model 下拉：
- 静态预设（per kind / per preset hardcode）+ 动态 fetch 来的 `/v1/models`，合并去重，预设在前。
- 旁边 `[Refresh]` 按钮：重拉 `/v1/models` 更新缓存。
- 仍允许 `Custom...` 自填（兜底）。
- 拉取失败 → 回落静态预设，UI 显示一行 warning。

#### 4.4.3 Add / Edit Provider 弹窗

按 kind 渲染：

**kind = openai-compatible**:
- Preset 下拉：`OpenAI` / `DeepSeek` / `Moonshot` / `SiliconFlow` / `Groq` / `Custom...`
  - 选预设 = 自动填 base URL + 默认 label
  - Custom = 用户自填
- Base URL 输入框（可改）
- API Key 输入框（type="password"，编辑模式留空 = 保留旧值）
- Label 输入框（默认从 preset 来，可改）
- `[Test & Save]` 按钮：调 `GET {baseURL}/models`，成功 → 入库 + 缓存 model 列表；失败 → 红色 inline 错误，不入库

**kind = local**:
- Base URL（默认 `http://127.0.0.1:11434/v1`）
- Label（默认 "Local Ollama"）
- 无 API Key
- `[Test & Save]` 同上

**kind = claude-code-daemon**:
- 仅 Label
- 无 base URL / key
- `[Test & Save]` → 后端 daemon 健康检查

#### 4.4.4 tRPC router

新建 `src/server/routers/ai-settings.ts`（替代旧 `billing` 中的 ai 相关 procedure）：

- `listProviders(): Provider[]`（不含 plaintext key）
- `addProvider(input): { providerId }`
- `updateProvider(id, input): void`
- `deleteProvider(id): void`（被 role 引用 → 先返回 `RoleReferenceError`，UI 弹确认）
- `testProvider(id): { ok: true; modelIds: string[] } | { ok: false; error: string }`
- `getRoleAssignments(): Record<role, { providerId, modelId } | null>`
- `setRoleAssignment(role, { providerId, modelId }): void`
- `listProviderModels(providerId, { refresh: boolean }): { models: string[] }`

每个 mutation 完成后调 `invalidateProviderPrefCache(userId)`。

### 4.5 删除清单

整体删除：
- `src/server/ai/provider/codex.ts`
- `src/server/billing/ai-providers/hosted.ts`（hosted 路由整套）
- 旧 `src/app/(app)/settings/ai-provider-section.tsx` / `model-picker.tsx`（重写）

部分删除：
- `src/server/ai/provider/identity.ts`：删 codex / cursor / hosted 分支，保留 daemon / openai-compatible / local
- `src/server/ai/provider/ai-sdk.ts`：删 cursor 分支，删 OPENAI_BASE_URL / LOCAL_AI_* 等 env 读取
- `src/server/ai/provider/mode.ts`：删 env 解析、`hasCodexAuthProfile`、`AI_PROVIDER` 整套；保留 `invalidateProviderPrefCache`（语义不变，缓存内容换成新 schema）
- `src/server/ai/provider/index.ts`：重写 dispatcher，砍掉 hosted / codex 分支
- `src/server/ai/provider/types.ts`：`AIProviderMode` enum 删除（被 `kind` 替代）
- `src/server/council/persona-stream.ts`：删自己读 `OPENAI_API_KEY` 的旁路，改走新 façade
- `src/server/ai/embeddings.ts`：删 env 读取，改走 `generateEmbeddings({ userId })`

废弃 env（从 `process.env` 读取处全部删除）：
- `AI_PROVIDER`
- `KNOSI_HOSTED_MODE`
- `KNOSI_CODEX_ACCOUNT_POOL`
- `OPENAI_API_KEY`（作为 provider 凭据；embeddings 也改走 façade）
- `OPENAI_BASE_URL` / `OPENAI_ORGANIZATION` / `OPENAI_PROJECT`
- `OPENAI_CHAT_MODEL` / `OPENAI_TASK_MODEL` / `OPENAI_MODEL`
- `CURSOR_PROXY_URL` / `CURSOR_PROXY_KEY` / `CURSOR_*_MODEL`
- `LOCAL_AI_*` / `AI_BASE_URL` / `AI_API_KEY` / `AI_*_MODEL`
- `CODEX_*` / `OPENCLAW_*`

**保留**：
- `KNOSI_SECRET_KEY`（新增，加密 master key）
- `LANGFUSE_*`（observability，无关）
- `CLAUDE_CODE_CHAT_MODEL`（identity 文案用，daemon kind 默认 model 来源）—— 待 plan 阶段确认是否一起搬到 DB
- `daemon-mode.ts` / `cli-auth*.ts`（CLI daemon 进程相关，不动）

### 4.6 Caller 切换审计

每个 AI 调用 caller 必须明确指定 role：

| Caller | 文件 | role |
|---|---|---|
| Ask AI 主聊天 | `src/app/api/chat/route.ts` | `chat` |
| Council persona 流 | `src/server/council/persona-stream.ts` | `chat` |
| Council classifier | `src/server/council/classifier.ts`（如有） | `task` |
| Drifter | `src/app/api/drifter/route.ts` | `chat` |
| 标签自动生成 | `src/server/ai/...`（实施时定位） | `task` |
| 摘要自动生成 | 同上 | `task` |
| RAG indexer | `src/server/ai/indexer.ts` / `chunking.ts` | `embedding` |
| Notes 各种结构化生成 | `src/server/routers/notes.ts` 之类 | `task` |

Plan 阶段第一步是 `grep` 一遍所有 `streamChatResponse` / `generateStructuredData` / embedding 调用点，逐个标注 role。

### 4.7 一次性引导

旧用户首次升级后，`ai_providers` / `ai_role_assignments` 都为空。访问任何 AI 功能 → 抛 `MissingAiRoleError` → UI 跳横幅：

> AI 配置已重做，请到 [Settings] 配置 Provider 和 Role。

横幅消失条件：至少配齐 `chat` role。

## 5. Migration

### 5.1 Drizzle migration

1. `pnpm db:generate` 生成 SQL：
   - `CREATE TABLE ai_providers ...`
   - `CREATE TABLE ai_role_assignments ...`
   - `ALTER TABLE users DROP COLUMN ai_provider_preference`
   - `ALTER TABLE users DROP COLUMN ai_chat_model`
2. `pnpm db:push` 应用到本地 SQLite。
3. 验证本地 schema：`sqlite3 data/knosi.db ".schema ai_providers"` 等。

### 5.2 生产 Turso rollout（CLAUDE.md 第 4 条规范）

不能停在本地，必须显式跑生产：

```bash
# 凭证位置见 .env.turso-prod.local
turso db shell <db> < drizzle/00xx_provider_refactor.sql

# 验证查询
turso db shell <db> "select sql from sqlite_master where name in ('ai_providers','ai_role_assignments')"
turso db shell <db> "pragma table_info(users)"
```

把命令和输出写入 `docs/changelog/`。

### 5.3 数据迁移

不做。直接重来：

- 旧 `users.ai_provider_preference` / `users.ai_chat_model` 直接 drop
- env 配置不读
- 用户登录后看到引导横幅，重新配 provider 和 role

## 6. 测试

### 6.1 单元 / 集成测试（vitest）

- `src/server/ai/crypto.test.ts`：
  - 加密解密往返
  - 同一 plaintext 加密两次 IV 不同
  - 错 secret 解密抛 `ApiKeyDecryptionError`
  - 空字符串 / 空 enc 处理
- `src/server/ai/provider/resolve.test.ts`（替代旧 `mode.test.ts`）：
  - role 解析返回正确 ResolvedProvider
  - 缺 role assignment → `MissingAiRoleError`
  - daemon kind + embedding role → schema 阻止；即便绕过 schema，runtime 也拦截
  - 缓存失效 (`invalidateProviderPrefCache`) 立即生效
- `src/server/ai/provider/ai-sdk.test.ts` 改造：去掉 cursor / codex case，新增 openai-compatible custom baseURL case。

### 6.2 E2E（Playwright）

`e2e/ai-settings.spec.ts`：

- Settings → Add Provider (OpenAI preset, fake key) → 列表显示
- Edit Provider → 改 label → 列表更新
- Set Chat role (provider + model) → 保存
- Ask AI 发条消息 → 拦截 fetch（`page.route`）确认请求 URL 走选定 provider
- 删 Provider 时若被 role 引用 → 弹确认
- 砍掉 / 调整旧的 `cursor` / `codex` / `hosted` 相关 e2e

### 6.3 验证三件套（CLAUDE.md 第 2 条）

每次大改完依次跑：

```bash
pnpm build
pnpm lint
pnpm test:e2e
pnpm test     # 单元测试，新增
```

## 7. 安全考量

- `KNOSI_SECRET_KEY` 启动校验缺失即拒启动，避免明文 key 入库。
- API key 永不出 server boundary（tRPC 不返回，logger 不打印）。
- `ai_providers.user_id` 上加 RLS-ish 检查：所有 router procedure 都用 `getRequestSession()` 拿 userId 后再查 / 改，绝不接受 client 传的 userId。
- 加密 IV 每行 random（GCM 安全要求），不重用。
- daemon kind 不存 key 等敏感字段，UX 上 zero-config。

## 8. 验证 / Definition of Done

- [ ] 新 schema 在本地 push、生产 Turso rollout 完成、changelog 记录验证 query
- [ ] `KNOSI_SECRET_KEY` 在 GitHub Actions secret + Hetzner k8s secret 都配好
- [ ] 旧 6 个 provider 选项完全消失（grep 项目级零命中：`AI_PROVIDER` / `cursor` / `codex` / `hosted-ai` / `knosiProvidedAi`-as-ai-routing）
- [ ] Settings UI 能完整 add / edit / test / delete provider 和 set role
- [ ] Ask AI / Council / Drifter / 标签 / 摘要 / RAG indexer 全部走新 façade
- [ ] `pnpm build` / `pnpm lint` / `pnpm test` / `pnpm test:e2e` 全绿
- [ ] `docs/changelog/` 有一条完整 entry
- [ ] 部署到 Hetzner，AI 各功能在线上跑通至少一条 happy path

## 9. Open questions

- Plan 阶段定：daemon kind 的 model 列表（`opus` / `sonnet` 等）是 hardcode 静态预设，还是允许用户自填？倾向 hardcode 加 Custom 兜底。
- Plan 阶段定：embedding 的 model 选择是否要单独限制（如必须是 `text-embedding-*` 字符串）？倾向不限制，让用户自负。
- 是否需要 per-Note / per-Project 覆写 chat role？v1 不做（已划入 Out of scope），但保留可扩展性（`ai_role_assignments` 主键现在是 `(user_id, role)`，未来可加 `scope_id` 做扩展）。

## 10. 决策记录（brainstorm 过程）

- Provider 列表：保留 OpenAI-compatible / Local / Claude Code Daemon，砍 knosi-hosted / codex / cursor。
- OpenAI 和 OpenAI-compatible 合并为一个 kind，DeepSeek / Moonshot 等通过 preset 选预填 base URL。
- Local 单列（不并入 OpenAI-compatible），UI 视角"云端 vs 本机"分得开。
- 配置全部存 DB，env 仅保留 `KNOSI_SECRET_KEY`。
- API key 加密：AES-256-GCM + 单 master key。
- AI Roles 三组：Chat / Task / Embedding。
- Provider 凭据 + Role 选择两段式 UI（不在每个 Role 内嵌完整凭据）。
- Model 列表：静态预设 + 动态 `/v1/models`，Refresh 按钮兼任连通测试。
- 旧数据：直接 drop，不做迁移。
- daemon 也是 Provider，按 kind 渲染不同表单。
