# Cursor LLM Proxy Provider — Phase A (knosi side)

**Date**: 2026-05-01

## 任务 / 目标

把 Cursor Pro 订阅当 OpenAI-兼容 LLM backend 复用 — 在 knosi.xyz 反代 cursor-to-openai
（Caddy + Bearer key 校验，详见 spec §2 + cursor-proxy 仓库），并在 knosi 加一种新的
provider mode `"cursor"`，让用户在 Settings 里能选 Cursor (Proxy) 这个 provider。

Phase A 范围：knosi 仓库内的代码改动 + 验证 + commit。服务器端 cursor-proxy（docker
+ Caddy patch + 续期脚本）走独立流水线。

## 关键变更

### 后端 — provider 抽象

- `src/server/ai/provider/types.ts`
  - `AIProviderMode` 加 `"cursor"` 成员
  - `maxStepsByMode("cursor")` 返回 6（与 openai 同档 — Claude / GPT class 模型有
    plan-over-tool-calls 头部空间）
- `src/server/ai/provider/ai-sdk.ts`
  - 新增 `DEFAULT_CURSOR_CHAT_MODEL` / `DEFAULT_CURSOR_TASK_MODEL = "claude-4.6-sonnet-medium"`
    （Phase B 校准）
  - `createAiSdkProvider` cursor 分支：要求 `CURSOR_PROXY_URL` + `CURSOR_PROXY_KEY`
    都设置；走 `createOpenAI({ name: "cursor-proxy", baseURL, apiKey })`
  - `resolveAiSdkModelIdSync` cursor 分支：
    `CURSOR_CHAT_MODEL` / `CURSOR_TASK_MODEL` → `CURSOR_MODEL` → built-in default
  - `AiSdkMode = Exclude<..., "codex" | "claude-code-daemon">` 自动包含 cursor
- `src/server/ai/provider/mode.ts`
  - `AiProviderPreference` 加 `"cursor"`
  - `getProviderModeSync` — `AI_PROVIDER=cursor` 透传到 `"cursor"`
  - `getProviderMode` 不动（已透传 `pref as AIProviderMode`）
  - 自动检测顺序保持不动 — cursor 必须显式 opt-in（避免无意中选到违反 ToS 的 backend）

### 后端 — billing router

- `src/server/routers/billing.ts`
  - `setAiProviderPreference` 的 zod enum 加 `"cursor"`
  - 新增 `getAiProviderPreference: protectedProcedure.query` — 供 daemon-banner 读
    用户 pref（spec §3.5 / §3.8）

### 前端 — Settings UI

- `src/app/(app)/settings/ai-provider-section.tsx`
  - `ProviderOption.value` 加 `"cursor"`
  - `OPTIONS` 末尾追加 `Cursor (Proxy)` 条目，desc:
    `"Reuse your Cursor subscription via knosi.xyz/cursor proxy"`
- `src/app/(app)/settings/model-picker.tsx`
  - `ProviderValue` 加 `"cursor"`
  - `PRESET_MODELS.cursor`（Phase B 已校准 — 8 项，跨家族 + 推理档位铺开）：
    `claude-4.6-sonnet-medium`, `claude-4.6-opus-high`, `claude-4.6-opus-max`,
    `claude-opus-4-7-thinking-xhigh`, `gpt-5.5-medium`, `gpt-5.5-high`,
    `gpt-5.4-medium`, `gemini-3.1-pro`

### Bug fix — daemon-banner provider-aware

- `src/components/ask/daemon-banner.tsx`
  - 加 `trpc.billing.getAiProviderPreference.useQuery`
  - 早返回新增条件：`pref?.preference !== "claude-code-daemon"` → return null
  - 修复：之前无脑显示 "daemon offline"，新加 cursor 时切到 Cursor provider 仍会被
    这条 banner 干扰。属于在已有改动范围内的合理范围扩展（spec §3.8）

### 数据库

- 无 migration — `users.aiProviderPreference` 是 `text` 字段，加新枚举值无需 schema
  变更

### 测试

- `src/server/ai/provider/ai-sdk.test.ts` — 新增 6 个 cursor 用例：
  built-in default / `CURSOR_CHAT_MODEL` / `CURSOR_MODEL` / 用户 pref 仍优先 /
  task kind 走 cursor task default / sync 入口
- `src/server/ai/provider/mode.test.ts` — 新增 2 个 cursor 用例：
  `AI_PROVIDER=cursor` sync / 用户 pref `"cursor"` 透传
- `e2e/per-user-provider.spec.ts` — 新增 1 个 e2e：选 Cursor 保存 →
  preset 模型可见 → 选 `claude-4.6-opus-high` reload 后仍 checked。
  另：`X-Knosi-Mode` 调试头白名单加上 `"cursor"`

## 文件

```
修改：
  src/server/ai/provider/types.ts
  src/server/ai/provider/ai-sdk.ts
  src/server/ai/provider/mode.ts
  src/server/routers/billing.ts
  src/app/(app)/settings/ai-provider-section.tsx
  src/app/(app)/settings/model-picker.tsx
  src/components/ask/daemon-banner.tsx
  src/server/ai/provider/ai-sdk.test.ts
  src/server/ai/provider/mode.test.ts
  e2e/per-user-provider.spec.ts

新增：
  docs/changelog/2026-05-01-cursor-llm-proxy-provider.md
```

## 验证

- `pnpm build`: 见 commit 附录
- `pnpm lint`: 见 commit 附录
- `pnpm test:e2e -- per-user-provider`: 见 commit 附录

## 部署侧 env 注入（Phase A 后续步骤，不在本 commit 内）

knosi pod 需要：

```
CURSOR_PROXY_URL=https://knosi.xyz/cursor/v1
CURSOR_PROXY_KEY=<跟 Caddy systemd drop-in 同一个值>
```

具体位置实施时探查 `ops/hetzner/deploy.sh` + 当前 deployment yaml/env 注入方式
（k8s secret + envFrom 还是 deployment env）。

## 部署纪要 — spec 偏差（实测发现）

部署时发现的 spec 假设错误，已就地处理：

1. **cursor-to-openai 镜像 `:latest` 已过时**：
   - `ghcr.io/jiuz-chn/cursor-to-openai:latest` 仍是 v2.5.0，硬编码
     `cursorClientVersion = "0.48.7"`，被 Cursor 后端拒绝
     （`ERROR_GPT_4_VISION_PREVIEW_RATE_LIMIT` "Update Required"）
   - 改用从源码 build：`git clone JiuZ-Chn/Cursor-To-OpenAI` →
     `docker build -t cursor-to-openai:local .` → compose 改 `image: cursor-to-openai:local`
   - 上游 commit `530e4f0` 已把版本号改成可配 env `CURSOR_CLIENT_VERSION`，
     默认 `2.6.21`，能用
2. **cookie 是客户端 OAuth token，不是浏览器 session**：
   - spec § 2 假设 `WorkosCursorSessionToken` 直接当 cookie 用 — 错。
     那是 `type: web` JWT，Cursor 后端只接受 `type: session` 的
     PKCE OAuth 客户端 token
   - 正确取法：`docker exec cursor-to-openai npm run login` →
     给一个 `cursor.com/cn/loginDeepControl?challenge=...&uuid=...` 链接 →
     浏览器登录授权 → 容器轮询 `api2.cursor.sh/auth/poll` 拿
     `user_xxx::eyJ...` 形式 client cookie
   - 旧版 `loginDeepControl` HTTP endpoint 在 v2.5.0 镜像里**不存在**
3. **容器从请求头读 cookie，不从 env 读**：
   - spec § 2.2 `CURSOR_COOKIE` env 设了也没用
   - 实际架构改为：Caddy 校验我们自己的 `CURSOR_PROXY_KEY` 后用
     `header_up Authorization "Bearer {env.CURSOR_COOKIE}"` 把请求头**替换**成 client cookie
   - cookie 落 `/etc/caddy/cursor.env` (`chmod 600`, `caddy:caddy`)，
     由 systemd drop-in `EnvironmentFile=` 注入
     （`Environment=` 行对超长 JWT token 无声丢弃，不能用）

## 残留风险

1. **协议变更**：Cursor 客户端升级可能让 cursor-to-openai 反代失效 — 接受手动
   `git pull && docker build && docker compose up -d` 追上游
2. **Cursor fast quota（150/月）**：自用低频，超额会 429
3. **Token 失效期间服务挂**：spec § 2.6 Auto-3 续期脚本已就位但需要按真实 cookie 流程
   重写（当前脚本假设 loginDeepControl HTTP endpoint，需改为
   `docker exec cursor-to-openai npm run login` + 提示用户浏览器授权）
4. **没有 fallback**：cursor 挂了之后 Ask AI 跟着挂；用户可手动切回别的 provider
