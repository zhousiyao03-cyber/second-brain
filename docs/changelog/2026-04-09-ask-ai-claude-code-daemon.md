# Ask AI via local Claude Code daemon — 2026-04-09

## 任务
让 Ask AI 通过用户本机的 Claude 订阅回答问题，即使从线上 Vercel 网页访问也一样。沿用项目里现有的"入队 + 本地 daemon 认领 + 回传"架构（跟 OSS 源码分析那条路对称），把 chat 请求放到同一个 daemon 里执行。

## 关键改动

### Schema（2 个迁移）
- `drizzle/0019_graceful_next_avengers.sql` — 新增三张表：
  - `chat_tasks`（queued/running/completed/failed/cancelled 的任务队列 + messages JSON + systemPrompt + model + totalText）
  - `daemon_chat_messages`（text_delta / text_final / error 流式事件 + taskId/seq 组合 unique index）
  - `daemon_heartbeats`（kind 作为 PK 的 liveness 表，用于 daemon 心跳）
- `drizzle/0020_white_kronos.sql` — 把 `chat_tasks_status_created_idx` 从 `uniqueIndex` 改为普通 `index`（尾部 `id` 列 PK 使唯一约束没意义）
- **命名偏差**：新的流式事件表命名为 `daemonChatMessages` / `daemon_chat_messages`，避让 schema.ts:94 的 legacy v1 `chatMessages` 会话持久化表（两张表 shape 完全不同，都保留）

### Provider mode 扩点（`src/server/ai/`）
- `daemon-mode.ts` — 新增 `shouldUseDaemonForChat()` helper，只在 `AI_PROVIDER=claude-code-daemon` 时返回 true
- `provider.ts`：
  - `AIProviderMode` 类型新增 `"claude-code-daemon"` 成员
  - `getProviderMode()` 识别显式模式，不做自动探测
  - `streamChatResponse()` 在 daemon 模式下直接抛错（表示调用路径有 bug，chat route 应该已经走入队分支）
  - `generateStructuredData()` 在 daemon 模式下**降级**到 codex/openai/local 的自动级联（Learn 大纲 / OSS 分析 / Portfolio news 这些非交互结构化任务不入队，保持现有体验）
  - `getChatAssistantIdentity()` + `getAISetupHint()` 新增 daemon 文案
- `chat-system-prompt.ts` — 从 `api/chat/route.ts` 抽出的共享 helper（`buildSystemPrompt`、`normalizeMessages`、`sanitizeMessages`、`getUserMessageText`、`RetrievedKnowledgeItem`），daemon enqueue 和现有 streamText 路径共用同一个 RAG system prompt
- `chat-enqueue.ts` — `enqueueChatTask({ userId, messages, sourceScope })`：跑 agentic RAG → 构造 system prompt → insert `chat_tasks` row → 返回 `{ taskId }`

### API routes（7 新增）
- `POST /api/chat` 加 daemon 分支 —— 命中时走 `enqueueChatTask` 返回 `{ taskId, mode: "daemon" }`；否则原 streamText 路径不变
- `POST /api/chat/claim` —— daemon 拿最早一条 queued 任务，atomic 转 running
- `POST /api/chat/progress` —— daemon 批量写 `daemon_chat_messages`
- `POST /api/chat/complete` —— daemon 报 completed / failed
- `GET /api/chat/tokens?taskId=xxx&afterSeq=N` —— 前端 polling，带 userId ownership 检查
- `POST /api/daemon/ping` —— daemon 心跳 upsert 到 `daemon_heartbeats`
- `GET /api/daemon/status?kind=chat` —— 前端读心跳，90 秒未见算离线
- `GET /api/config` —— 返回 `{ chatMode: "daemon" | "stream" }`，前端 mount 时拿一次
- `GET /api/cron/cleanup-stale-chat-tasks` —— Vercel Cron 每 15 分钟扫一次，把 `running > 10 分钟` 的任务标 failed

### Daemon（`tools/usage-reporter/report.mjs`）
- 新增常量 `CHAT_POLL_INTERVAL_MS=3s`、`MAX_CONCURRENT_CHAT=3`、`HEARTBEAT_INTERVAL_MS=30s`
- `getMessageText` / `flattenMessagesToPrompt` — 把对话历史拍扁成单 prompt 字符串（历史部分用 `## 之前的对话历史` + `## 当前问题` 分节）
- `spawnClaudeForChat({ prompt, systemPrompt, model, onText })` — spawn `claude -p <prompt> --append-system-prompt <system> --output-format stream-json --verbose [--model opus]`，**不**传 `--allowedTools`（纯 LLM 模式）；读 stream-json 中 `assistant` 事件里的 text block，每块作为"cumulative 快照"通过 `onText(block.text)` 回调（前端 overwrite 而非 append）
- `handleChatTask(task)` —— 镜像 `handleAnalysisTask` 结构：批量 flush text deltas 到 `/api/chat/progress`（每 8 条或 150ms），最后发 `text_final` 标记 + `/api/chat/complete`
- `pollChatTasks` —— 每 3 秒 `/api/chat/claim`，并发上限 3
- `heartbeat('chat')` —— 启动时立即一次 + 每 30 秒一次
- 启动日志新增 chat 轮询间隔 + 心跳间隔 print

### 前端（`src/components/ask/` + `src/app/(app)/ask/page.tsx`）
- `use-daemon-chat.ts` —— 新 hook，手写 state 机（`idle/submitting/streaming/error`）。sendMessage 时先 POST `/api/chat` 拿 taskId，然后进 polling loop（300ms 间隔）读 `/api/chat/tokens`，遇到 text_delta 就 overwrite 当前 assistant message 的 text，直到 status=completed。2 分钟超时保护，stop() 只停本地 polling
- `daemon-banner.tsx` —— 橙色横幅，每 30 秒查一次 `/api/daemon/status?kind=chat`，离线时显示最后心跳相对时间
- `/ask` page 拆成 `AskPageStream`（原 useChat + TextStreamChatTransport 路径，完全不动）+ `AskPageDaemon`（新 hook + DaemonBanner）。默认 export 变成薄 wrapper，mount 时 fetch `/api/config` 拿 `chatMode`，然后渲染对应子组件。加载期间显示 "Loading..."

### 运维
- `vercel.json` 新增 cron 条目 `/api/cron/cleanup-stale-chat-tasks` 每 15 分钟
- `.env.example` 新增 `AI_PROVIDER=claude-code-daemon` + `CLAUDE_CODE_CHAT_MODEL=opus` 注释块
- `README.md` 新增 "Using Claude Subscription via Local Daemon" 章节

## 本地自验证
_待手动填充。_

预期步骤：
1. `pnpm build` 全程通过（Task 1-16 实施期间每个 task 都 build 过）
2. `.env.local` 设 `AI_PROVIDER=claude-code-daemon`，`CLAUDE_CODE_CHAT_MODEL=opus`
3. Terminal A: `pnpm dev`
4. Terminal B: `pnpm usage:daemon`，确认启动日志里有 `Chat 任务轮询间隔: 3s` + `Heartbeat 间隔: 30s`
5. 浏览器访问 `http://localhost:3200/ask` —— 横幅不出现
6. 发问"请用一句话介绍自己" —— 看流式输出、看 daemon 终端里的 claim/done 日志
7. Ctrl+C Terminal B daemon，等 90 秒刷新 `/ask`，确认橙色横幅出现
8. 把 `.env.local` 切回 `AI_PROVIDER=codex` 重启 dev，确认 `/ask` 回到原 useChat 路径，横幅消失
9. `pnpm test:e2e` —— 现有 E2E 套件仍然通过（E2E 保持 codex provider，不覆盖 daemon 模式）

## 剩余风险 / 后续
- 生产 Turso 迁移 rollout 见下一节（Task 18）
- 没有 cancel API（第一版），前端 stop() 只停 polling，daemon 会继续跑完然后静默完成
- `claude -p --output-format stream-json` 输出每个 assistant text block 是"完整句"而非严格 token delta —— 前端约定 overwrite（而非 append），daemon 每次 emit 当前累计文本。体感接近流式但比 codex 原生 delta 略粗
- `daemon_heartbeats` 单行 per kind，每 30 秒一次写入，量级可忽略；如果 Turso 写压力成为问题可改为内存
- 生产 Vercel 部署 `AI_PROVIDER=claude-code-daemon` 后，如果本机 daemon 没开，所有 chat 请求会永远 queued 直到 cron 标 failed —— 这时用户看到横幅并得知要开 daemon 或切 provider

## Production rollout — 2026-04-09

Code pushed to `main` (commit `7740f17`). Vercel auto-deploy picks up the new build but with existing env vars, so `/api/config` still returns `chatMode: "stream"` and `/ask` keeps using the legacy streaming path until env vars flip. This is intentional — the rollout is safe to stage: code lands first, switch to daemon mode on the box.

### Pending manual steps (user-side, CLI tools not installed on dev box)

Run these from a machine with `turso` and `vercel` CLIs installed and logged in. Install if needed:

```bash
brew install tursodatabase/tap/turso   # or: curl -sSfL https://get.tur.so/install.sh | bash
npm install -g vercel
turso auth login
vercel login
```

Then rollout:

```bash
cd /Users/bytedance/second-brain

# 1. Apply schema to production Turso
turso db shell <your-db-name> < scripts/db/2026-04-09-chat-daemon-schema.sql

# 2. Verify tables
turso db shell <your-db-name> "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_tasks','daemon_chat_messages','daemon_heartbeats') ORDER BY name;"
# Expected: 3 rows

turso db shell <your-db-name> "SELECT sql FROM sqlite_master WHERE name='chat_tasks_status_created_idx';"
# Expected: "CREATE INDEX ..." (no UNIQUE keyword)

# 3. Set Vercel production env vars
vercel env add AI_PROVIDER production
# Paste: claude-code-daemon
vercel env add CLAUDE_CODE_CHAT_MODEL production
# Paste: opus

# 4. Trigger a new deploy to pick up the new env vars
vercel deploy --prod
# Or: push an empty commit to main if auto-deploy is wired

# 5. Verify the deployed /api/config returns daemon mode
curl https://second-brain-self-alpha.vercel.app/api/config
# Expected: {"chatMode":"daemon"}

# 6. Point the local daemon at production and smoke test
SECOND_BRAIN_URL=https://second-brain-self-alpha.vercel.app pnpm usage:daemon

# In another browser/phone, open https://second-brain-self-alpha.vercel.app/ask,
# log in, send a question. It should stream back from your local daemon.

# 7. Stop the daemon, wait 90s, refresh /ask — amber banner should appear.
```

### Results

**Turso rollout (2026-04-09)** — ✅ Applied via one-shot script `scripts/db/apply-2026-04-09-rollout.mjs` (reads credentials from `.env.turso-prod.local`, uses `@libsql/client` to execute the 5 DDL statements in `scripts/db/2026-04-09-chat-daemon-schema.sql`). Verified:

```
Tables: chat_tasks, daemon_chat_messages, daemon_heartbeats
chat_tasks_status_created_idx SQL: CREATE INDEX `chat_tasks_status_created_idx` ON `chat_tasks` (`status`,`created_at`,`id`)
Legacy chat_messages row count: 0
daemon_chat_messages_task_seq_idx SQL: CREATE UNIQUE INDEX `daemon_chat_messages_task_seq_idx` ON `daemon_chat_messages` (`task_id`,`seq`)
```

All three tables present, status index is non-unique (correct), daemon task_seq index is unique (correct), legacy `chat_messages` table untouched.

**Vercel env vars + redeploy** — ⏳ Pending. User needs to add the two env vars to Vercel (dashboard or CLI), then push/redeploy:
- `AI_PROVIDER=claude-code-daemon`
- `CLAUDE_CODE_CHAT_MODEL=opus`

Until this is done, the hosted `/api/config` returns `{"chatMode":"stream"}` and `/ask` keeps using the legacy streaming path — which is safe (no breakage to existing users).

**Hosted smoke test** — ⏳ Pending. After env vars are set and the next deploy finishes:
1. `curl https://second-brain-self-alpha.vercel.app/api/config` → should return `{"chatMode":"daemon"}`
2. `SECOND_BRAIN_URL=https://second-brain-self-alpha.vercel.app pnpm usage:daemon` on your local machine
3. Open https://second-brain-self-alpha.vercel.app/ask from a browser, send a question → should stream back via the local daemon
4. Stop the daemon, wait 90s, refresh `/ask` → amber banner should appear
