# Ask AI Daemon — Persistent Worker Pool with Session Resume

**Status:** Draft
**Author:** Claude (Opus 4.7) with user
**Date:** 2026-04-25

---

## 背景

当前 Ask AI 的 Claude Code daemon 存在严重的"不顺手"问题。代码现状：

1. [`packages/cli/src/spawn-claude.mjs:14-24`](../../packages/cli/src/spawn-claude.mjs) 每个 chat task 都用 `claude -p <prompt> --tools ""` 启动一个**全新的、一次性的** Claude CLI 子进程
2. [`packages/cli/src/handler-chat.mjs:13-41`](../../packages/cli/src/handler-chat.mjs) 把整段对话历史拍扁成一个 Markdown 字符串塞进 `-p` 参数，每次都重传
3. 没有 `--resume`，模型在跨任务之间是失忆的——只有把历史塞进 prompt 才能维持"对话感"
4. 没有 `--input-format stream-json`，进程是"一次性的、ad-hoc 的"，spawn 完就退出

这导致每次提问都要付出：
- **Cold start**（CLI 启动 + 初始化）≈ 数秒
- **重传整段 history** 的 token 成本
- 跨任务"记忆"完全靠重新塞 prompt

参考 wanman（[`D:/repos/wanman/packages/runtime/src/claude-code.ts:132`](D:/repos/wanman/packages/runtime/src/claude-code.ts) + [`agent-process.ts:1`](D:/repos/wanman/packages/runtime/src/agent-process.ts)）的 `idle_cached` 模式：进程按需启动，但通过 `--resume <sessionId>` 跨触发恢复对话上下文，组合 stream-json IO 实现"配置一次、之后一直顺手"。

本 spec 把这套模式移植到 Knosi daemon 的 chat 路径上。

---

## 目标与非目标

### 目标
- 消除每次提问的 cold start：对同一会话连续提问，第二次起 < 1s 看到 token 开始吐
- 对话上下文跨任务连续：模型记得之前说过什么，无需把 history 重塞进 prompt
- 长会话不再线性变慢/变贵：history 不重传
- daemon 进程内"自治"——崩溃恢复、idle 回收、resume 失败 fallback 都自动处理
- 外部接口（CLI 命令、env 变量、API 端点）保持不变；schema 增量加列，不破坏老数据

### 非目标
- 不启用 daemon 内 Claude 的工具/skills/MCP（保留 `--tools ""`，与原 spec 保持一致；Research Mode 那一波再启用）
- 不改 `generateStructuredData` 路径（结构化任务一发一收，session 复用对它无意义）
- 不动 RAG 检索逻辑本身（`retrieveAgenticContext` / `retrieveContext` 不变）
- 不改前端 `/ask` UI（只改数据流入口）
- 不引入新的第三方依赖
- 不做"多 daemon 抢同一会话"的协调（个人工具，单 daemon）

---

## 关键架构决策

### 决策 1：把 RAG context 从 system prompt 移到 user message preamble

**问题**：当前 [`buildSystemPrompt`](../../src/server/ai/chat-system-prompt.ts:191) 把检索到的 RAG chunks 拼进 system prompt 的 `<knowledge_base>` 块。每次提问 RAG 召回不同 chunks → system prompt 不同。

**这跟 `--resume` 不兼容**：resumed session 的 system prompt 由首次 spawn 锁定，后续 `--system-prompt` 参数即便传了也未必生效（行为未文档化，不可赌）。

**方案**：把 system prompt 拆成两层：
- **稳定层（system prompt 本体）**：identity + scope hint + 行为规则（结构化块、引用规则等）。**只随 `sourceScope` / 请求类型变化，不随 RAG 变化**
- **变化层（user message preamble）**：`<knowledge_base>` / `<current_note>` / `<pinned_sources>`。每次提问注入到**最新的 user 消息前面**

实现入口：在 [`chat-enqueue.ts`](../../src/server/ai/chat-enqueue.ts) 中，把 `buildSystemPrompt` 拆成 `buildSystemPromptStable` + `buildUserPreamble`，写库前把 preamble 注入到 `messages[lastUserIdx].content` 的开头。

**收益**：
- system prompt 稳定 → `--resume` 安全可用
- prompt cache 命中率上升（system prompt 不再每次抖动）
- 概念更清晰：context 永远绑定到产生它的那次提问，不污染整段对话

### 决策 2：Worker pool 以 `(userId, sourceScope, structuredFlag)` 为 key

不同 scope 的 RAG 行为不同（`notes` / `bookmarks` / `direct` / `all`），用户切换 scope 实质上是"开新会话"。`structuredFlag` 影响 system prompt（结构化块指令的有/无）。

```
workerKey = `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`
```

每个 workerKey → 至多一个活跃的 Claude 子进程。同 key 内消息**串行化**（一条处理完才处理下一条，防止并发导致状态污染）。

### 决策 3：Idle timeout 10 分钟，session_id 持久化

- Worker spawn 时若有已知 session_id → `claude --resume <id>`
- Worker 收到 `system/init` 事件 → 捕获新 session_id（resume 后会换新 id）→ 持久化到 DB
- 10 分钟无新任务 → 杀掉子进程，**保留 session_id**
- 下次有任务进来 → 重新 spawn 并 `--resume`，恢复完整对话上下文
- Resume 失败（捕获 wanman 用过的 `RESUME_MISSING_PATTERN`）→ 清掉 session_id，重 spawn fresh，把完整 history 塞进首条 user 消息（fallback）

### 决策 4：Schema 新增独立表 `daemon_conversations`

不放在 `chat_tasks` 表里——`chat_tasks` 是任务级的（一个任务一行），session 是会话级的（跨任务持久）。

```sql
CREATE TABLE daemon_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_key TEXT NOT NULL,
  cli_session_id TEXT,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, worker_key)
);
```

### 决策 5：stream-json IO 模式

替换当前的 `claude -p prompt` 单次模式：

```bash
claude \
  --model <model> \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --tools "" \
  --system-prompt "<stable_system>" \
  [--resume <sessionId>]
```

进程 stdin 持续开放，daemon 通过写入 JSONL 行（`{"type":"user","message":{"role":"user","content":"..."}}`）发送新消息。stdout 持续吐 JSONL 事件，daemon 解析 `stream_event` 提取 text_delta，遇到 `result` 事件视为本轮完成。

### 决策 6：Backwards compat —— 内部清理替换，无 feature flag

- `@knosi/cli` 的 daemon 内部完全重写 chat 路径（structured 路径不动）
- 用户重装 daemon (`npm i -g @knosi/cli@latest`) 即获得新行为
- Web 端的 `chat_tasks` 表向后兼容：新增 `daemon_conversations` 表，老 `chat_tasks` 行不受影响
- 旧 daemon 版本在 stream-json 协议变化下应该会立即报错而非静默错误（spawn args 不同），符合 fail-loud 原则
- 不加 env flag："想要可切换"会拖慢 demo 的兑现，违背用户"立马改进"的诉求

### 决策 7：跳过改进 3（SSE 直推）的"换协议"部分

当前 [`daemon.mjs:260-298`](../../packages/cli/src/daemon.mjs) 已经用 SSE wake notifications。剩下的所谓"polling"是 `claimTask`（POST /api/chat/claim），这是必要的原子领取动作。fallback 30s 安全网保留——便宜、防御性。

改进 3 在本 spec 不动；视为已经基本到位。

---

## 架构

```
┌────────────────────────────────────────────────────────────────┐
│ Browser /ask                                                   │
└──────────────────┬─────────────────────────────────────────────┘
                   │ POST /api/chat (daemon mode)
                   ▼
┌────────────────────────────────────────────────────────────────┐
│ Web (Next.js)                                                  │
│  enqueueChatTask:                                              │
│    1. retrieveAgenticContext()                                 │
│    2. systemPrompt = buildSystemPromptStable(scope, flags)     │
│    3. preamble = buildUserPreamble(retrievedCtx, ...)          │
│    4. messages[last].content = preamble + originalContent      │
│    5. INSERT chat_tasks (status=queued, systemPrompt=stable)   │
│    6. publishDaemonTaskNotification("wake")                    │
└──────────────────┬─────────────────────────────────────────────┘
                   │ SSE wake notification
                   ▼
┌────────────────────────────────────────────────────────────────┐
│ Daemon (user's machine)                                        │
│                                                                │
│  Notification listener → requestDrain("chat")                  │
│  drain → claimTask("chat") → got task                          │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ChatWorkerPool                                           │  │
│  │   Map<workerKey, ClaudeChatWorker>                       │  │
│  │                                                          │  │
│  │  getOrSpawn(workerKey, systemPrompt, lastSessionId):     │  │
│  │    if alive → return                                     │  │
│  │    else spawn:                                           │  │
│  │      claude --input-format stream-json                   │  │
│  │             --output-format stream-json                  │  │
│  │             --system-prompt <stable>                     │  │
│  │             [--resume <sessionId>]                       │  │
│  │      register stdout JSONL parser                        │  │
│  │      register idle timer (10 min)                        │  │
│  │                                                          │  │
│  │  enqueue(task) → serialized per worker                   │  │
│  │    write user message to stdin                           │  │
│  │    pipe text_delta → POST /api/chat/progress             │  │
│  │    on result → POST /api/chat/complete                   │  │
│  │    on system/init → save sessionId to DB                 │  │
│  │                                                          │  │
│  │  on idle expiry / process exit → remove from pool        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 数据流细节

### Web 侧改动（[`chat-enqueue.ts`](../../src/server/ai/chat-enqueue.ts)）

```ts
// before:
const systemPrompt = buildSystemPrompt(context, sourceScope);
await db.insert(chatTasks).values({ messages: JSON.stringify(messages), systemPrompt, ... });

// after:
const systemPrompt = buildSystemPromptStable(sourceScope, options); // 不含 RAG context
const preamble = buildUserPreamble(context, options);                // RAG / pinned / current_note
const augmentedMessages = injectPreambleIntoLatestUser(messages, preamble);
await db.insert(chatTasks).values({
  messages: JSON.stringify(augmentedMessages),
  systemPrompt,
  ...
});
```

注意：`augmentedMessages` 是把 preamble 拼到**最后一个 user 消息的 content 前面**，老 history 不动。

### Schema 改动（[`src/server/db/schema/chat.ts`](../../src/server/db/schema/chat.ts)）

新增 `daemon_conversations` 表（见决策 4）。

`chat_tasks` 表**不动**——session 状态不属于任务级。

### Daemon 侧新增 / 改动

**新增 `packages/cli/src/chat-worker.mjs`**：单个 worker 的封装
- 持有 child process + stdout 解析器 + 当前任务的 onText/onComplete/onError 回调
- 持有 idle timer
- 持有任务队列（serial）
- 暴露 `enqueueTask(task) → Promise<{ totalText, sessionId }>`
- 暴露 `kill()`

**新增 `packages/cli/src/chat-worker-pool.mjs`**：worker 池管理
- `getOrCreate(workerKey, systemPrompt, model, lastSessionId)` 
- `removeWorker(workerKey)`（idle 或 exit 时调用）
- `dispatch(task)`：根据 task 算 workerKey，确保 worker 存在，调 `enqueueTask`

**改 `packages/cli/src/handler-chat.mjs`**：从直接调 spawn-claude 改成走 pool dispatch

**改 `packages/cli/src/api.mjs`**：新增两个 endpoint 调用
- `getDaemonConversation(workerKey) → { cliSessionId | null }`
- `setDaemonConversation(workerKey, cliSessionId) → void`

**新增 Web API endpoints**：
- `GET /api/daemon/conversations/:workerKey` → 返回 (userId 来自 bearer token, workerKey 来自 path) 对应的 sessionId
- `PUT /api/daemon/conversations/:workerKey` → upsert sessionId

**`packages/cli/src/spawn-claude.mjs`**：保留 `spawnClaudeForStructured`（结构化任务不变）；废弃 `spawnClaudeForChat`（被新 worker 取代）

---

## 失败模式与处理

| 场景 | 处理 |
|---|---|
| Resume 失败（CLI 找不到 session）| 捕获 stderr / result event 中匹配 wanman 的 `RESUME_MISSING_PATTERN` 正则；清掉 DB 中的 sessionId；重 spawn fresh；首条消息把完整 history 塞进 user 消息（拍扁逻辑保留作为 fallback） |
| Claude 子进程意外崩溃 | 捕获 close 事件；移除 worker；当前任务标 failed 并 POST `/api/chat/complete?error`；下次同 workerKey 来任务时重新 spawn |
| Daemon 进程重启 | 内存中的 worker pool 清空；DB 中的 sessionId 保留；下次任务进来直接 spawn + resume，无缝恢复 |
| stdin pipe 写失败 | worker 视为已死，触发崩溃路径 |
| stdout JSONL 解析错误 | 跳过该行（与现有 spawn-claude 一致）；继续累积 |
| Idle 期间用户切 scope | 老 workerKey idle 自然过期；新 workerKey 全新会话开始 |
| 同一 workerKey 并发任务 | worker 内部 promise 队列串行处理；第二个 await 第一个完成才启动 |
| Web→daemon SSE 断开 | 现有 reconnect 逻辑（`runNotificationLoop`）继续生效；fallback polling 安全网兜底 |
| `--system-prompt` 与 resumed session 不一致 | 通过决策 1（RAG 移到 user message）已经从根上消除 |

---

## 测试策略

按 [`AGENTS.md`](../../AGENTS.md) "Verification Rules"：

1. **Unit**（vitest，`*.test.ts` / `*.test.mjs`）：
   - `injectPreambleIntoLatestUser` —— 历史不动、preamble 拼到 last user content 前
   - `buildSystemPromptStable` —— 输出不含 `<knowledge_base>` / `<current_note>` / `<pinned_sources>` 任何标签
   - `buildUserPreamble` —— 上述三块按需出现，空 context 时返回空字符串
   - `chat-worker-pool` workerKey 计算逻辑

2. **Integration**（daemon CLI 侧 mjs 测试）：
   - Mock `spawn` 返回 fake child process；验证 stream-json 协议正确：spawn args 含 `--input-format stream-json` 等；stdin 写入符合 `{"type":"user",...}` 格式
   - 模拟 `system/init` 事件被消费、sessionId 被 PUT 回 server
   - 模拟 resume 失败（emit RESUME_MISSING_PATTERN），验证清 sessionId + 重 spawn

3. **E2E**（Playwright）：
   - `e2e/ask-ai-daemon.spec.ts`（如已存在则扩展，否则新建）：
     - 启动 daemon `--once` 模式 + 单 chat 任务跑通
     - 第二条提问到达时，验证 `chat_tasks.totalText` 完整、`daemon_conversations.cli_session_id` 不为空

4. **手工验证**（用户体感）：
   - 启动 daemon，问"你好"，秒表测从 sendMessage 到首个 token 出现的时间（baseline 基线）
   - 紧接着问"再给我说一遍"，秒表测同样指标
   - 期望：第二次显著快于第一次，且回答能引用第一次的内容（证明 session 通了）

---

## 性能预期

| 指标 | 当前 | 改造后 |
|---|---|---|
| 首条消息首 token 延迟（cold） | 5–10s | 5–10s（首次 spawn 不变） |
| 同会话第 2 条消息首 token 延迟 | 5–10s（重新 spawn） | < 1s（worker 已活，stdin 直接喂） |
| 同会话第 N 条消息 token 成本 | O(整段 history) | O(本条 message) |
| 跨 idle（10 分钟无活动后再问）首 token 延迟 | 5–10s | 3–5s（spawn + resume，但跳过完整 history 重传） |

---

## 部署 / 上线步骤

按 [`CLAUDE.md`](../../CLAUDE.md) 流程：

1. **本地**：`pnpm db:generate` 生成 `daemon_conversations` migration
2. **本地**：`pnpm db:push` 应用到本地 SQLite
3. **本地**：`pnpm build && pnpm lint && pnpm test:e2e` 三步自验证
4. **本地**：实测两轮提问的连续性 + 速度
5. **commit + push** → GitHub Actions 自动部署到 Hetzner
6. **生产 Turso schema 同步**：在 production 上跑 `daemon_conversations` migration，验证表存在
7. `cd packages/cli && npm version patch && npm publish` 发布新 daemon 版本
8. 用户本机 `npm i -g @knosi/cli@latest` 升级 daemon

按 AGENTS.md "Schema 变更规则"：production rollout 命令和验证查询会记录到 `docs/changelog/`。

---

## 风险与开放问题

1. **`--input-format stream-json` 在 Windows 下的稳定性**：用户主力是 Windows 11，wanman 没在 Windows 跑过。需要实测 spawn `claude.cmd` 时 stdin pipe 是否稳定。**Mitigation**：单元测试覆盖；如果有 Windows 特异 bug，加 `windowsHide: true` 已经做了，必要时改用 `cross-spawn`
2. **`--system-prompt` 在 resumed session 下到底什么行为**：未在 Anthropic 文档明确。**Mitigation**：决策 1（RAG 移到 user message）让 system prompt 实际稳定，从根上回避了这个问题
3. **Idle timer 10 分钟是否合理**：太短 → 频繁 spawn 浪费冷启动；太长 → 内存占用 + claude 进程数堆积。**Mitigation**：暴露成常量便于调；首版 10 分钟，根据实测调
4. **多用户 daemon 共享主机的资源占用**：本工具是单人用，N/A
5. **Resume 后 sessionId 会变**：每次 resume 都返回一个新的 `system/init.session_id`，所以每条消息后都要 PUT 一次 DB。**Mitigation**：PUT 操作做成 fire-and-forget，失败仅 log 不阻塞返回

---

## 与现有 specs 的关系

- 复用 [`2026-04-08-ask-ai-claude-code-daemon-design.md`](2026-04-08-ask-ai-claude-code-daemon-design.md) 的整体"web enqueue + daemon claim + result 回传"骨架
- 兼容 [`2026-04-15-ask-ai-daemon-redis-stream-design.md`](2026-04-15-ask-ai-daemon-redis-stream-design.md) 的 Redis pub/sub 流式回传通道（不动）
- 兼容 [`2026-04-15-daemon-claim-notifications-design.md`](2026-04-15-daemon-claim-notifications-design.md) 的 SSE wake 通知机制（不动）
- 本 spec 是一个**纯 daemon 内部 + RAG 注入位置**的优化，不替代上述任何设计

---

## PLAN.md 关系

本 spec 不属于原 PLAN.md 中的任何 Phase——按 [`AGENTS.md`](../../AGENTS.md) "Before You Change Code" 第 1 条算 **explicit exception**：

- 当前 PLAN.md Phase 1–6 已全部 done（Phase 4 是 AI 集成 / RAG，已 done）
- "学习 Phase" B1–B10 是后端学习线，与本 spec 互不依赖
- 本 spec 是用户在使用过程中识别出的体验优化，独立交付
