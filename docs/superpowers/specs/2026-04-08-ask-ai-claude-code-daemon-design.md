# Ask AI via local Claude Code daemon — 线上也能用本地 Claude 订阅

**Status:** Draft
**Author:** Claude (Opus 4.6) with user
**Date:** 2026-04-08

---

## 背景

Second Brain 的 Ask AI 目前通过 `src/server/ai/provider.ts` 支持三种 provider：`codex` / `openai` / `local`。用户每月付 Claude Pro/Max 订阅，但订阅绑定的是"本机登录状态"（`~/.claude/auth.json`），部署到 Vercel 的 serverless function 没有这个文件 → **线上网页无法使用 Claude 订阅**。

用户此前已经为 OSS 源码分析实现了一套 **"线上入队 + 本地 daemon 认领 + 本地 spawn CLI + 结果回传"** 的架构（见 `docs/superpowers/specs/2026-04-05-analysis-daemon-design.md` + `tools/usage-reporter/report.mjs`）。这套架构已经在生产运行：本地 daemon 用 `claude -p <prompt> --output-format stream-json` 跑任务，通过 `/api/analysis/claim` / `/api/analysis/progress` / `/api/analysis/complete` 与线上通信。

本 spec 复用完全相同的 pattern 把 **Ask AI 的 chat 请求**也放到同一个 daemon 里执行，实现"浏览器访问 Vercel 上的 Second Brain 网页，真正的模型推理跑在用户本机"。

## Claudian 的启发 vs. 本架构的取舍

参考仓库 `https://github.com/YishenTu/claudian` 的 Claude provider 实现用了 `@anthropic-ai/claude-agent-sdk`。调研结论：

- **Claudian 能直接用 Claude Code CLI，是因为它是 Obsidian 桌面插件**，前端 UI 和 spawn CLI 的代码同进程。它**根本没有 "web 远端 server 如何拿到本地机器资源"** 这个问题。
- 因此 Claudian 的**架构形态**不适用于 Second Brain（Vercel 部署的 Next.js web app）。
- Claudian 唯一值得学的是"用 SDK 而不是手写 spawn"。但 Second Brain 的 daemon 已经在用 `claude -p --output-format stream-json`（原生 CLI 流式模式），工作得很好，**没必要再引入 `@anthropic-ai/claude-agent-sdk` 作为新依赖**。继续沿用现有 `spawnClaudeCli` 路径即可。

**结论**：架构 = 沿用 Second Brain 自己的 analysis daemon pattern；CLI 调用方式 = 沿用 daemon 已有的 `spawnClaudeCli`。**本 spec 无新增依赖**。

---

## 目标与非目标

### 目标
- 线上部署的 Second Brain（Vercel）也能使用用户本机的 Claude 订阅 / API key
- 默认生产环境 `AI_PROVIDER=claude-code-daemon`，Opus 作为默认 chat 模型
- Ask AI 流式体验保留：用户感受到 token 一个一个吐出来（polling 伪流式，300ms 间隔）
- daemon 状态对前端可见：daemon 未运行时 Ask AI 页面顶部横幅提示，用户不会困惑
- 当 daemon 不可用时有明确的 fallback 路径（手工切回 `codex` provider）

### 非目标
- 不引入新的第三方依赖（不引 `@anthropic-ai/claude-agent-sdk`、不引 Redis、不引 Upstash）
- 不做真正的 SSE / WebSocket（基于 DB polling 就够，跟现有 analysis progress 一致）
- 不改 RAG 逻辑（`retrieveAgenticContext` / `retrieveContext` 仍在 server 侧运行，daemon 只拿到已拼好的 systemPrompt）
- 不支持多个 daemon 同时抢任务（analysis 侧也没支持；个人工具）
- 不处理 Claude Code CLI 的认证设置（假设用户自己跑过 `claude login` 或设了 `ANTHROPIC_API_KEY`）
- 不改 `generateStructuredData` —— 结构化输出（Learn 大纲生成 / Portfolio 新闻聚合等）继续走 codex/openai 路径。原因：这些是非交互的背景任务，不值得为它们也搭一整条 daemon 队列。仅 chat 入 daemon
- 不支持 daemon 内的 Claude 使用任何工具（`--allowedTools` 留空或不传，让 Claude 变成纯 LLM chat）
- 不改前端 `/ask` 的 UI 样式，只改数据获取路径

---

## 架构

```
┌──────────────┐     POST /api/chat  (daemon mode)               ┌──────────────┐
│ Browser      │ ──────────────────────────────────────────────▶ │ Vercel       │
│ /ask page    │    { messages, sourceScope }                    │ Next.js      │
│              │                                                 │              │
│              │ ◀────────────────────────────────────────────── │ 1. RAG       │
│              │    { taskId, mode: "daemon" }                   │ 2. system    │
│              │                                                 │    prompt    │
│              │                                                 │ 3. insert    │
│              │                                                 │    chat_     │
│              │                                                 │    tasks     │
│              │                                                 │    (queued)  │
│              │                                                 └──────┬───────┘
│              │                                                        │
│              │                                                        │ Turso
│              │                                                        ▼
│              │                                                 ┌──────────────┐
│              │                                                 │ chat_tasks   │
│              │                                                 │ chat_messages│
│              │                                                 └──────┬───────┘
│              │                                                        ▲
│              │                                                        │
│              │ GET /api/chat/tokens                                   │
│              │   ?taskId=xxx&afterSeq=N                               │
│              │ ──────────────────────────────────────────────▶        │
│              │ ◀────────────────────────────────────────────── ┌──────┴───────┐
│              │   { messages: [{seq, delta}], status }          │ /api/chat/*  │
│              │   (every 300ms)                                 │ routes       │
└──────────────┘                                                 └──────┬───────┘
                                                                        ▲
                                                                        │
                                                                        │ POST
                                                                        │
┌──────────────────────────────────────────────────────────┐            │
│ User's Mac  (tools/usage-reporter/report.mjs daemon)     │            │
│                                                          │            │
│ 每 3 秒 POST /api/chat/claim ───────────────────────────▶│            │
│                                                          │ claim      │
│ 拿到 task { id, systemPrompt, userPrompt }               │◀───────────┘
│                                                          │
│ spawn `claude -p <prompt>                                │
│        --append-system-prompt "<system>"                 │
│        --output-format stream-json --verbose`            │
│                                                          │
│ for each assistant text block / delta:                   │
│   POST /api/chat/progress ──────────────────────────────▶│ append to
│   { taskId, messages: [{seq, delta}] }                   │ chat_messages
│                                                          │
│ on result:                                               │
│   POST /api/chat/complete ──────────────────────────────▶│ status =
│   { taskId, totalText, sources?, error? }                │ completed
└──────────────────────────────────────────────────────────┘
```

**类比关系（每个 Ask AI chat 对应一个 analysis task，字段对照）：**

| 现有 analysis              | 新 chat                   |
|----------------------------|---------------------------|
| `analysis_tasks`           | `chat_tasks`              |
| `analysis_messages`        | `chat_messages`           |
| `POST /api/analysis/claim` | `POST /api/chat/claim`    |
| `POST /api/analysis/progress` | `POST /api/chat/progress` |
| `POST /api/analysis/complete` | `POST /api/chat/complete` |
| `GET /api/analysis/messages` | `GET /api/chat/tokens`  |
| `handleAnalysisTask()`     | `handleChatTask()`        |
| `pollAnalysisTasks()`      | `pollChatTasks()`         |

**为什么不复用 `analysis_tasks` 表，而要新建 `chat_tasks`？** 字段差异太大：
- chat 不需要 `repoUrl` / `originalAnalysis`，需要 `messages` JSON（对话历史）
- chat 的轮询间隔更快（3 秒 vs analysis 10 秒），为响应感必须
- chat 没有"分析完成后写入 osProjectNotes"这个侧写动作

两张表独立、两个 API 组独立、daemon 里两条循环并行。保留语义清晰。

---

## 数据模型

### 新表 `chat_tasks`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK UUID | |
| `user_id` | TEXT FK → users ON DELETE CASCADE | 发起人 |
| `status` | TEXT | `"queued" \| "running" \| "completed" \| "failed" \| "cancelled"` |
| `source_scope` | TEXT | AskAiSourceScope，供审计用 |
| `messages` | TEXT (JSON) | 全量对话历史（`ModelMessage[]` 序列化），daemon 用来重建 prompt |
| `system_prompt` | TEXT | server 侧 RAG 拼好的完整 system prompt（含 knowledge base block） |
| `model` | TEXT | 实际用的模型别名（`"opus"` / `"sonnet"` / 具体 ID），server 写入，daemon 传给 CLI |
| `total_text` | TEXT | 完成后的完整回答（也会 stream 到 chat_messages，这里留全量供审计和诊断） |
| `error` | TEXT | 失败原因 |
| `created_at` | INTEGER timestamp | |
| `started_at` | INTEGER timestamp | daemon claim 时写 |
| `completed_at` | INTEGER timestamp | |

索引：`(status, created_at)` 用于 claim 查询。

### 新表 `chat_messages`

对齐现有 `analysis_messages` 的形状：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK UUID | |
| `task_id` | TEXT FK → chat_tasks ON DELETE CASCADE | |
| `seq` | INTEGER | daemon 侧递增序号 |
| `type` | TEXT | `"text_delta" \| "text_final" \| "error"` |
| `delta` | TEXT | 本次增量文本（text_delta / text_final 时写入） |
| `created_at` | INTEGER timestamp | |

索引：`(task_id, seq)` 用于前端 polling。

**为什么不用单列 `content` 覆盖多种 type**：预留给未来可能的 `tool_use` / `thinking` 事件（如果某天开启 Claude 工具或 extended thinking）。第一版实际上只 emit `text_delta` + 最后一条 `text_final`。

**`text_final` 的作用**：某些回答非常短，`text_delta` 可能只有一两条；前端靠 `text_final` 做收尾标记，结合 `chat_tasks.status === "completed"` 判断流结束。

### Schema migration

本地：`pnpm db:generate` + `pnpm db:push`。

生产 Turso：纯增量（两张新表，无 enum 改动，无旧表重建风险），可直接用 `drizzle-kit push` 或手写 SQL，按 CLAUDE.md 规则记录 rollout 命令和验证查询到 changelog。

---

## API 设计

### `POST /api/chat`（认证 required）— 新增 daemon 分支

这是现有的 chat 入口，本 spec **不新增单独的 `/api/chat/enqueue` route**，而是在现有 `/api/chat/route.ts` 的 POST handler 顶部加一个分支：`shouldUseDaemonForChat()` 为 true 时走 daemon 入队路径返回 `{ taskId, mode: "daemon" }`；否则走现有的 streamText 路径（codex/openai/local），返回原来的 `text/plain` 流。

**入参（daemon 模式下）：**
```ts
{
  messages: ModelMessage[] | UIMessage[];  // 全量对话历史（含最后一条 user）
  sourceScope?: AskAiSourceScope;          // 可选，默认 "all"
}
```

（跟现有 chat route 的入参完全一致；无需前端传额外字段。）

**Server 行为（daemon 分支）：**
1. 鉴权：`auth()` 取 userId，没有 → 401
2. Rate limit：沿用 `checkAiRateLimit(userId)`
3. 取最后一条 user message 的 text，跑 `retrieveAgenticContext(query, { scope })` → `context`
4. 用 `buildSystemPrompt(context, scope)` 构造 system prompt（复用现有逻辑，从 `api/chat/route.ts` 抽成独立工具函数 `src/server/ai/chat-system-prompt.ts`，两条路径都引用它）
5. 解析 model：env `CLAUDE_CODE_CHAT_MODEL` → 默认 `"opus"`
6. normalize messages 到 `ModelMessage[]` 后 insert `chat_tasks` row：status `queued`，messages JSON，systemPrompt，model
7. 记录 AI usage（`recordAiUsage` fire-and-forget）
8. 返回 `{ taskId, mode: "daemon" }` 作为 JSON

**出参（daemon 模式）：**
```ts
{ taskId: string; mode: "daemon" } | { error: string }
```

**出参（非 daemon 模式，未变）：** 现有的 `text/plain` 流响应，前端 `useChat` 照常消费。前端通过 `/api/config` 提前知道走哪条路，不会混淆。

### `POST /api/chat/claim`（无认证）

daemon 调用，拿下一条 queued 任务。

**Server 行为：**
1. `SELECT * FROM chat_tasks WHERE status='queued' ORDER BY created_at LIMIT 1`
2. 没有 → `{ task: null }`
3. 有 → atomically `UPDATE ... SET status='running', started_at=NOW()`
4. 返回 `{ task: { id, userId, model, systemPrompt, messages } }`

daemon 侧按 `messages` 数组拍扁成一段 user prompt 文本（规则见 daemon 章节）。

### `POST /api/chat/progress`（无认证）

daemon 增量上报 assistant text delta。

**入参：**
```ts
{
  taskId: string;
  messages: Array<{
    seq: number;
    type: "text_delta" | "text_final" | "error";
    delta?: string;
  }>;
}
```

**Server 行为：** 批量 insert chat_messages。

### `POST /api/chat/complete`（无认证）

daemon 报完成。

**入参：**
```ts
{
  taskId: string;
  totalText?: string;  // 成功时的完整回答
  error?: string;      // 失败时
}
```

**Server 行为：**
1. 成功：`UPDATE chat_tasks SET status='completed', completed_at=NOW(), total_text=?`
2. 失败：`UPDATE chat_tasks SET status='failed', completed_at=NOW(), error=?`

### `GET /api/chat/tokens`（认证 required）

前端 polling 拉增量。

**入参（query）：**
```
taskId=xxx
afterSeq=N
```

**Server 行为：**
1. 鉴权 + 验证 taskId 的 owner 是当前用户
2. `SELECT seq, type, delta FROM chat_messages WHERE task_id=? AND seq>? ORDER BY seq LIMIT 500`
3. 同时返回 `chat_tasks.status` 和 `chat_tasks.total_text`（当完成时）和 `error`

**出参：**
```ts
{
  messages: Array<{ seq: number; type: string; delta: string | null }>;
  status: "queued" | "running" | "completed" | "failed";
  totalText?: string;  // 仅 completed 时
  error?: string;      // 仅 failed 时
}
```

### `POST /api/chat/cancel`（认证 required，可选 - 第二版）

用户在 Ask AI UI 点 stop 按钮时调用。第一版先不做（daemon claim 后杀 process 的逻辑比较麻烦），前端的 stop 按钮只在本地停止 polling 即可，daemon 那边继续跑完然后任务就静悄悄结束。标为 TODO。

### `POST /api/daemon/ping`（无认证）

daemon 心跳。

**入参：**
```ts
{ kind: "chat" | "analysis" | "usage"; version?: string }
```

**Server 行为：** upsert 一条 `daemon_heartbeats` 行（或简化为 env-key 记录在内存 / KV）。第一版：**新增一个 `daemon_heartbeats` 表**（字段 `id / kind / last_seen_at`），daemon 每 30 秒 ping 一次任意 kind。

### `GET /api/daemon/status`（认证 required）

前端查 daemon 存活状态。

**出参：**
```ts
{
  online: boolean;       // 最后心跳 < 90 秒
  lastSeenAt: string | null;  // ISO
  seconds_since: number | null;
}
```

---

## Daemon 改造

改 `tools/usage-reporter/report.mjs`，新增：

### Chat 任务循环

和 `pollAnalysisTasks` 并列：
```js
const CHAT_POLL_INTERVAL_MS = 3 * 1000;   // 3 秒（比 analysis 快 3 倍）
const MAX_CONCURRENT_CHAT = 3;
let chatRunning = 0;

async function pollChatTasks() {
  if (chatRunning >= MAX_CONCURRENT_CHAT) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/chat/claim`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.task) return;
    chatRunning++;
    handleChatTask(data.task).catch(() => {}).finally(() => { chatRunning--; });
  } catch { /* skip */ }
}
```

在主循环里加：
```js
setInterval(pollChatTasks, CHAT_POLL_INTERVAL_MS);
setInterval(() => heartbeat("chat"), 30 * 1000);
```

### `handleChatTask(task)`

```js
async function handleChatTask(task) {
  // 1. Flatten messages -> single prompt string
  const prompt = flattenMessagesToPrompt(task.messages);

  // 2. Spawn claude CLI
  let seq = 0;
  const pending = [];
  let flushTimer = null;

  async function flush() { /* POST /api/chat/progress */ }

  function onText(delta) {
    seq++;
    pending.push({ seq, type: "text_delta", delta });
    if (pending.length >= 8) flush();
    else if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 150);
  }

  try {
    const totalText = await spawnClaudeForChat({
      prompt,
      systemPrompt: task.systemPrompt,
      model: task.model,
      onText,
    });
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
    await fetch(`${SERVER_URL}/api/chat/complete`, {
      method: "POST",
      body: JSON.stringify({ taskId: task.id, totalText }),
    });
  } catch (err) {
    await fetch(`${SERVER_URL}/api/chat/complete`, {
      method: "POST",
      body: JSON.stringify({ taskId: task.id, error: err.message }),
    });
  }
}
```

### `spawnClaudeForChat`

类似现有 `spawnClaudeCli` 但参数不同：
```js
function spawnClaudeForChat({ prompt, systemPrompt, model, onText }) {
  const args = [
    "-p", prompt,
    "--append-system-prompt", systemPrompt,
    "--output-format", "stream-json",
    "--verbose",
  ];
  if (model) args.push("--model", model);
  // no --allowedTools → no tools granted (cannot read files / run bash)

  return new Promise((resolve, reject) => {
    const child = cpSpawn(process.env.CLAUDE_BIN || "claude", args, { stdio: ["ignore","pipe","pipe"] });
    let lineBuf = "";
    let finalResult = "";
    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                // full-text block emit — CLI emits these when text is finalized
                // for each assistant message. We send the new portion since last emit.
                onText(block.text);
              }
            }
          }
          if (event.type === "result" && event.result) {
            finalResult = event.result;
          }
        } catch { /* skip */ }
      }
    });
    child.on("close", (code) => code === 0 ? resolve(finalResult) : reject(new Error(`claude exit ${code}`)));
    child.on("error", reject);
  });
}
```

**关于流式粒度的重要细节**：`claude -p --output-format stream-json --verbose` 输出的 `assistant` 事件里，每个 text block 是**一次性到位**的整句话，不是 token-by-token。这意味着前端的"流式感"来自于多条 assistant message 分批到达，不是严格 character-by-character 的流。**这比 codex 的原生 token stream 略粗**，但对 Ask AI 的体验仍然可接受（每 200-500ms 一段文本到达）。第一版先这么做，真实体验如果不够顺再考虑调 `claude` CLI 的 flags 或换 Agent SDK。

### `flattenMessagesToPrompt`

```js
function flattenMessagesToPrompt(messages) {
  // Find last user message (this is the "current question")
  // Previous history = everything before it
  const lastUserIdx = findLastUserMessageIndex(messages);
  const history = messages.slice(0, lastUserIdx);
  const lastUser = messages[lastUserIdx];

  let historyText = "";
  if (history.length > 0) {
    historyText = "## 之前的对话历史\n\n" +
      history.map(m => {
        const role = m.role === "user" ? "用户" : "助手";
        const text = getText(m.content);
        return `**${role}：** ${text}`;
      }).join("\n\n") +
      "\n\n---\n\n";
  }

  return historyText + "## 当前问题\n\n" + getText(lastUser.content);
}
```

System prompt（包含 RAG 上下文）**独立通过 `--append-system-prompt` 传**，不混进 prompt body。

### 心跳

```js
async function heartbeat(kind) {
  try {
    await fetch(`${SERVER_URL}/api/daemon/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
  } catch {}
}
```

每次 daemon 启动、以及每 30 秒调一次。

---

## Provider mode 集成

`src/server/ai/provider.ts`：
- `AIProviderMode` 加入 `"claude-code-daemon"`
- `getProviderMode()`：显式 `AI_PROVIDER=claude-code-daemon` 时命中。不做自动探测（会和 codex 自动探测冲突）
- `streamChatResponse()`：这个函数**不改**。它只处理"当前请求直接走 LLM 调用返回 Response"的场景（codex/openai/local 路径）
- `generateStructuredData()`：daemon 模式下**降级走 codex**（或按用户配的 fallback provider）。理由：这些结构化任务不是交互的，用户不应该感受到 daemon 延迟；而且很多 spec 都已写过继续用 codex 即可
- 新增 helper `shouldUseDaemonForChat(): boolean` — `getProviderMode() === "claude-code-daemon"`

### `api/chat/route.ts` 分支

改造这个 route 的 POST handler：
```ts
export async function POST(req: Request) {
  // ... auth + rate limit + parse body (unchanged)

  if (shouldUseDaemonForChat()) {
    // New path: enqueue to chat_tasks, return taskId
    const { taskId } = await enqueueChatTask({ userId, messages, sourceScope });
    return Response.json({ taskId, mode: "daemon" });
  }

  // Existing path (codex/openai/local): stream directly
  // ... existing code unchanged
}
```

`enqueueChatTask` 是新内部函数，接收 `{ userId, messages, sourceScope }`，完成 RAG + system prompt 构造 + insert chat_tasks，返回 `{ taskId }`。它被直接在 `/api/chat/route.ts` 的 daemon 分支里调用 —— **不新开 `/api/chat/enqueue` route**。前端始终 POST 到 `/api/chat`；响应体的 `Content-Type` 或 `mode` 字段决定前端接下来怎么处理（流 vs polling）。

由于前端也会先调 `GET /api/config` 拿到 `chatMode`，它会提前知道这次请求应该读流还是读 JSON taskId。`useDaemonChat` hook 只在 `chatMode === "daemon"` 时激活；`useChat` 只在非 daemon 时激活。两个 hook 互斥，不会同时 POST `/api/chat`。

---

## 前端改动

`src/app/(app)/ask/page.tsx` 现状用 `@ai-sdk/react` 的 `useChat` + `TextStreamChatTransport`。daemon 模式下这套机制不适用，因为响应不是一个流而是一个 taskId。

**做法：改造 `useChat` 的 transport，或者放弃 `useChat` 手写一套状态机。**

我倾向**手写**，因为：
1. `useChat` 的 `transport` API 是围绕流式响应设计的，塞一个轮询 polyfill 会很丑
2. daemon 模式下 `messages` 状态管理本来就简单（只有"发送中 / 轮询中 / 完成 / 失败"）
3. 保留现有 codex 流式模式的代码路径不变，只在 daemon 模式下用新的 hook

**新 hook `useDaemonChat()`：**
```ts
function useDaemonChat(options: { api: string; sourceScope: AskAiSourceScope }) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<"idle"|"submitting"|"streaming"|"error">("idle");
  const [error, setError] = useState<Error | null>(null);

  async function sendMessage({ text }: { text: string }) {
    // 1. Add user message to state
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    setMessages(prev => [...prev, userMsg]);
    setStatus("submitting");

    // 2. POST /api/chat
    const res = await fetch(options.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [...messages, userMsg], sourceScope: options.sourceScope }),
    });
    const body = await res.json();

    if (body.mode !== "daemon") {
      // fallback: shouldn't happen in daemon mode but handle gracefully
      throw new Error("Unexpected non-daemon response in daemon mode");
    }

    // 3. Start polling
    const taskId = body.taskId;
    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: "assistant", parts: [{ type: "text", text: "" }] }]);
    setStatus("streaming");

    let lastSeq = 0;
    let accumulated = "";

    while (true) {
      const tokenRes = await fetch(`/api/chat/tokens?taskId=${taskId}&afterSeq=${lastSeq}`);
      const tokenData = await tokenRes.json();

      for (const m of tokenData.messages) {
        if (m.type === "text_delta" && m.delta) {
          accumulated = m.delta; // CLI emits full-text snapshots, not strict deltas
          lastSeq = m.seq;
        }
      }

      // Update assistant message
      setMessages(prev => prev.map(msg =>
        msg.id === assistantId
          ? { ...msg, parts: [{ type: "text", text: accumulated }] }
          : msg
      ));

      if (tokenData.status === "completed") {
        if (tokenData.totalText) {
          setMessages(prev => prev.map(msg =>
            msg.id === assistantId
              ? { ...msg, parts: [{ type: "text", text: tokenData.totalText }] }
              : msg
          ));
        }
        setStatus("idle");
        break;
      }

      if (tokenData.status === "failed") {
        setStatus("error");
        setError(new Error(tokenData.error || "Daemon task failed"));
        break;
      }

      await new Promise(r => setTimeout(r, 300));
    }
  }

  return { messages, status, error, sendMessage };
}
```

**注意 "full-text snapshots" 细节**：因为 `claude -p --output-format stream-json` 的 `assistant` block 是整句式而非严格的 delta，daemon 侧 `onText(block.text)` 每次发的都是**当前已知的完整文本**（或大段替换）。前端用 `accumulated = m.delta` **覆盖**而不是拼接。这个约定写到 daemon 和前端的注释里。

**第一版退而求其次**：daemon 侧保持"每次 emit 当前完整文本"，前端覆盖。未来如果要精确的 token delta，改一处 daemon side 的 diff 计算就行。

### `/ask` page 模式感知

```ts
const daemonStatus = trpc.daemon.status.useQuery(undefined, {
  refetchInterval: 30 * 1000,
  enabled: chatMode === "daemon", // chatMode loaded once from GET /api/config on mount
});
```

**如何让前端知道当前是 daemon 模式？** 两个方案：
1. 页面初始化时 fetch `/api/config` 读 `AI_PROVIDER` —— 简单
2. 第一次 `POST /api/chat` 的响应里就有 `mode: "daemon" | "stream"` 字段，前端按响应决定后续

**采纳方案 1**，增加 `GET /api/config`（public）返回 `{ chatMode: "daemon" | "stream" }`。这样 Ask AI 页面一加载就能决定走哪条路、是否显示 daemon 横幅。其他前端逻辑不需要。

### Daemon 未运行横幅

```tsx
{chatMode === "daemon" && daemonStatus.data && !daemonStatus.data.online && (
  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
    <strong>本地 Claude daemon 未运行</strong> — Ask AI 依赖你本机的 usage daemon 来调用 Claude CLI。
    请运行 <code>pnpm usage:daemon</code> 启动。
    最后心跳：{daemonStatus.data.lastSeenAt ? formatRelative(daemonStatus.data.lastSeenAt) : "从未"}
  </div>
)}
```

---

## 环境变量

新增：
```bash
AI_PROVIDER=claude-code-daemon    # 启用 daemon 模式
CLAUDE_CODE_CHAT_MODEL=opus       # 默认 opus
# 或 "sonnet" / "claude-opus-4-6" 等。daemon 传给 claude --model
```

daemon 侧沿用已有：
```bash
SECOND_BRAIN_URL=https://second-brain-self-alpha.vercel.app
CLAUDE_BIN=claude  # 可选，默认查 PATH
```

README 新章节写明：想用 Claude 订阅（不花 API 费）→ 必须在本机跑 daemon；生产模式下 daemon 停了就只能降级 `AI_PROVIDER=codex`。

---

## 错误处理与降级路径

| 场景 | 表现 | 用户可做的 |
|------|------|-----------|
| daemon 未运行 | `/api/chat` 入队，任务永远 queued；前端横幅警告；polling 超 60s 无进度 → 前端显示 "daemon 未响应" 并允许重试 | 启动 daemon，或 `.env.local` 切 `AI_PROVIDER=codex` 重启 |
| daemon claim 后崩溃 | task 停在 `running` 永不完成 | server 侧：定时任务把 `running` 超过 10 分钟的 task 标为 `failed` |
| claude CLI 未登录 | daemon `spawnClaudeForChat` 报错 → `/api/chat/complete` 带 error 提示 "Claude CLI not authenticated" | 用户自己 `claude login` |
| Claude 额度/限流 | CLI 返回错误消息，daemon 转发为 task error | 等额度 / 切 codex |
| 用户刷新页面 | 当前 taskId 丢失（仅存 hook 状态），daemon 还在跑但结果无人接收。**第一版：接受这个行为**，后续可把 taskId 存 localStorage 让用户回来恢复 | 等下一次重问 |
| Vercel API route 超时 | 新 API 都是纯 DB 读写，<100ms，不会超时 | N/A |
| DB 累积太多 chat_messages | 定时清理超 7 天的 completed tasks 及其 messages | 加 cron |

**Running 任务超时清理**：新建 Vercel Cron `/api/cron/cleanup-stale-chat-tasks`，每 15 分钟扫一次 `status='running' AND started_at < now() - 10 minutes` 的任务标 failed。

---

## 验收标准

### 本地手动验证
1. `pnpm db:generate` + `pnpm db:push` 生成并应用 migration，无错误
2. `pnpm build` + `pnpm lint` 通过
3. 设置 `.env.local`：`AI_PROVIDER=claude-code-daemon`，`CLAUDE_CODE_CHAT_MODEL=opus`
4. 起两个终端：
   - Terminal A: `pnpm dev`
   - Terminal B: `pnpm usage:daemon`
5. 访问 `http://localhost:3200/ask`
   - 顶部**不应该**有 "daemon 未运行" 横幅（因为 Terminal B 在跑）
   - 发问 "用一句话介绍你自己" → 3 秒内开始出字，整段回答完整出现
   - 观察 Terminal B 有 `[时间] 🗨️ chat task` 类日志
6. 停掉 Terminal B，等 90 秒，刷新 `/ask`
   - 顶部**应该**出现 "daemon 未运行" 横幅
   - 再发问 → 任务会 queued，polling 60s 后前端显示 "daemon 未响应" + 重试按钮
7. 重启 daemon，点重试 → 任务被 claim → 正常完成
8. 切 `.env.local` 到 `AI_PROVIDER=codex`，重启 dev → `/ask` 页面不再显示 daemon 横幅，走原来的 streamText 流，确认 codex 路径未被破坏

### 线上验证
1. 把两张表的 migration 跑到 Turso 生产
2. Vercel 环境变量设 `AI_PROVIDER=claude-code-daemon`
3. 本机 daemon 跑着（配 `SECOND_BRAIN_URL=https://second-brain-self-alpha.vercel.app`）
4. 手机或另一台机器访问 https://second-brain-self-alpha.vercel.app/ask → 问问题 → 能正常流式收到回答
5. 停 daemon → 线上 /ask 出现横幅

### E2E 测试
**不加 E2E**。理由：
- E2E 环境没有 daemon，chat 任务会永远 queued
- `AUTH_BYPASS=true` 的 e2e 模式下默认走 codex 路径（现有 test），`AI_PROVIDER` 应保持 `codex` 不启用 daemon 模式。在 spec 中显式写明：**E2E 不覆盖 daemon 模式**，由手动验证兜底
- 可以在 `playwright.config.ts` 或测试 setup 里确保 `AI_PROVIDER=codex`，避免意外

### 验证查询（production rollout 后必跑）
```sql
-- 确认新表存在
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_tasks','chat_messages','daemon_heartbeats');

-- 确认无遗留冲突数据
SELECT COUNT(*) FROM chat_tasks;
```

---

## 开放问题 / 决策澄清

1. **model 别名是否支持 Claude Code 识别？**
   - `claude -p --model opus` 是否接受 `opus` / `sonnet` 别名？需要在 spec 执行阶段本地验证；如不接受，fallback 到完整 ID `claude-opus-4-6`
   - 这是本 spec 唯一需要实机验证的开放点

2. **为什么 daemon 侧把 system prompt 走 `--append-system-prompt`？**
   - `--append-system-prompt` 是 append 到 Claude Code 默认 system prompt 后面
   - 更纯的 "纯 LLM 模式" 应该用 `--system-prompt`（完全覆盖）— 但 CLI 是否支持待确认
   - 第一版用 `--append-system-prompt` 保守起见；如果 Claude Code 默认 prompt 污染了回答风格，再切成覆盖

3. **daemon 心跳表 vs. 内存**：目前选 DB 表存（跨部署存活）。如果 Turso 写压力成为问题（每个用户 × 30 秒），可降级为单行 `UPDATE daemon_heartbeats SET last_seen_at=NOW() WHERE kind='chat'`，写入 <1 KB/次，可接受

---

## 实施任务拆分（给 writing-plans 阶段）

1. Schema：新建 `chat_tasks` / `chat_messages` / `daemon_heartbeats` 三张表；生成 migration；记录 production rollout SQL
2. 通用工具抽取：`src/server/ai/chat-system-prompt.ts` 从 `api/chat/route.ts` 抽出 `buildSystemPrompt` 和 RAG context 构造
3. Provider mode：`provider.ts` 新增 `claude-code-daemon` mode，`shouldUseDaemonForChat()` helper，`generateStructuredData` 降级到 codex 的逻辑
4. Enqueue 路径：改造 `/api/chat/route.ts` 加 daemon 分支（POST 分两路：daemon → `enqueueChatTask` 返 `{taskId, mode:"daemon"}`；其他 → 原 streamText 流）；新增 4 个 daemon-side API routes：`POST /api/chat/claim`、`POST /api/chat/progress`、`POST /api/chat/complete`、`GET /api/chat/tokens`
5. Daemon 心跳：新增 `/api/daemon/ping` + `/api/daemon/status` + `GET /api/config` 三个 API routes
6. Daemon 改造：`tools/usage-reporter/report.mjs` 新增 chat 循环、`handleChatTask`、`spawnClaudeForChat`、`flattenMessagesToPrompt`、心跳
7. 前端：`useDaemonChat` hook；`/ask` page 按 `/api/config.chatMode` 分路；daemon 横幅 UI
8. Stale task 清理 cron：`/api/cron/cleanup-stale-chat-tasks`
9. README + `.env.example` 文档
10. 本地冒烟（按验收清单）+ production rollout + changelog 入库

---

## 附录 A：为什么不拆成两个 spec

本 spec 同时涉及"provider 扩点"和"daemon 新能力"。考虑过拆成两个，但：
- provider 改 2 行就完事，单独成 spec 太薄
- daemon 侧和 server API 侧必须一起落地才能验证
- 前端 UI 改动也必须一起才能手工冒烟
- 整个闭环体验是**合起来才成立**的故事

所以合并为单 spec，下游由 writing-plans 拆成原子 task。
