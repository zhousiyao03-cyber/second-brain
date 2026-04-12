# Knosi CLI — 用户本地 Claude Code Daemon（npm 包）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布一个独立 npm 包（`@knosi/cli`），用户在本地 `npx @knosi/cli` 启动常驻进程，自动从线上 Second Brain 拉取 AI 任务（chat + structured data），调用本地 Claude CLI 执行，并将结果推回线上。所有 AI 场景（Ask AI chat、focus 分析、学习笔记摘要、Portfolio 分析等）统一走这条通路。

**Architecture:** 线上 Vercel 应用将 AI 请求入队到 Turso DB（`chatTasks` 表），用户本地的 CLI daemon 通过 HTTP API 轮询 → claim → 调用 `claude -p` → 将结果通过 HTTP API 推回。与现有 `tools/usage-reporter/report.mjs` 中的 chat daemon 逻辑相同，但提取为独立 npm 包，并新增 `structured` 任务类型。

**Tech Stack:** Node.js (ESM) + child_process.spawn(`claude`) + HTTP API（fetch 线上服务）

---

## 现状与差距

### 已有
- `chatTasks` 表 + `daemonChatMessages` 表 + `daemonHeartbeats` 表
- HTTP API 端点：`/api/chat/claim`, `/api/chat/progress`, `/api/chat/complete`
- `report.mjs` 中的 `spawnClaudeForChat`, `handleChatTask`, `pollChatTasks`
- 前端 `use-daemon-chat.ts` + SSE `/api/chat/tokens`

### 缺失
1. **独立 npm 包** — chat daemon 代码嵌在 report.mjs 里，需要提取
2. **Structured 任务类型** — `generateStructuredData` 在 daemon 模式下回退到 codex/openai/local，不走 Claude CLI
3. **Structured 任务的 API 端点** — 需要 claim/complete 端点
4. **用户认证** — daemon 需要用某种 token 证明自己是合法用户

---

## File Structure

### 新建文件（npm 包）
| 文件 | 职责 |
|------|------|
| `packages/cli/package.json` | npm 包元数据 + bin 入口 |
| `packages/cli/src/index.mjs` | CLI 入口：解析参数、登录、启动 daemon |
| `packages/cli/src/api.mjs` | 封装线上 HTTP API 调用（claim/progress/complete/heartbeat） |
| `packages/cli/src/spawn-claude.mjs` | Claude CLI 子进程封装（chat 流式 + structured 同步） |
| `packages/cli/src/handler-chat.mjs` | Chat 任务处理器 |
| `packages/cli/src/handler-structured.mjs` | Structured data 任务处理器 |

### 修改文件（主项目）
| 文件 | 变更 |
|------|------|
| `src/server/db/schema.ts` | chatTasks 新增 `taskType` + `structuredResult` 列 |
| `src/server/ai/provider.ts` | `generateStructuredData` daemon 模式走入队 + 轮询 |
| `src/server/ai/chat-enqueue.ts` | 适配 `taskType` 字段 |
| `src/app/api/chat/claim/route.ts` | 支持 `taskType` 筛选 |
| `src/app/api/chat/complete/route.ts` | 支持 `structuredResult` 回写 |
| `tools/usage-reporter/report.mjs` | 移除 chat 相关代码 |

---

### Task 1: Schema — chatTasks 新增 taskType + structuredResult

**Files:**
- Modify: `src/server/db/schema.ts:762-791`

- [ ] **Step 1: 添加两个新字段**

在 `chatTasks` 表定义中，`status` 字段之后添加 `taskType`，`totalText` 之后添加 `structuredResult`：

```typescript
// status 字段之后
taskType: text("task_type", { enum: ["chat", "structured"] })
  .notNull()
  .default("chat"),
```

```typescript
// totalText 之后
structuredResult: text("structured_result"), // JSON string for structured task results
```

- [ ] **Step 2: 生成并应用迁移**

```bash
cd /Users/bytedance/second-brain/.worktrees/wip-changes
pnpm db:generate
pnpm db:push
```

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(daemon): add taskType and structuredResult columns to chatTasks"
```

---

### Task 2: API 端点 — claim 支持 taskType 筛选

**Files:**
- Modify: `src/app/api/chat/claim/route.ts`

- [ ] **Step 1: 从请求体读取 taskType 参数**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq, and, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  let taskType = "chat";
  try {
    const body = await request.json();
    if (body.taskType === "structured") taskType = "structured";
  } catch {
    // empty body = default to chat
  }

  // Reclaim zombies for this task type
  const zombieCutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MS);
  await db
    .update(chatTasks)
    .set({ status: "queued", startedAt: null })
    .where(
      and(
        eq(chatTasks.status, "running"),
        eq(chatTasks.taskType, taskType),
        lt(chatTasks.startedAt, zombieCutoff)
      )
    );

  const [task] = await db
    .select()
    .from(chatTasks)
    .where(and(eq(chatTasks.status, "queued"), eq(chatTasks.taskType, taskType)))
    .orderBy(chatTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  const now = new Date();
  const updated = await db
    .update(chatTasks)
    .set({ status: "running", startedAt: now })
    .where(and(eq(chatTasks.id, task.id), eq(chatTasks.status, "queued")))
    .returning({ id: chatTasks.id });

  if (updated.length === 0) {
    return NextResponse.json({ task: null });
  }

  let parsedMessages: unknown = [];
  try {
    parsedMessages = JSON.parse(task.messages);
  } catch {
    parsedMessages = [];
  }

  return NextResponse.json({
    task: {
      id: task.id,
      userId: task.userId,
      model: task.model,
      taskType: task.taskType,
      systemPrompt: task.systemPrompt,
      messages: parsedMessages,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/claim/route.ts
git commit -m "feat(daemon): claim endpoint supports taskType filtering"
```

---

### Task 3: API 端点 — complete 支持 structuredResult

**Files:**
- Modify: `src/app/api/chat/complete/route.ts`

- [ ] **Step 1: 支持 structuredResult 字段**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    totalText?: string;
    structuredResult?: string;
    error?: string;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const now = new Date();

  if (body.error) {
    await db
      .update(chatTasks)
      .set({ status: "failed", error: body.error, completedAt: now })
      .where(eq(chatTasks.id, body.taskId));
  } else {
    await db
      .update(chatTasks)
      .set({
        status: "completed",
        totalText: body.totalText ?? "",
        structuredResult: body.structuredResult ?? null,
        completedAt: now,
      })
      .where(eq(chatTasks.id, body.taskId));
  }

  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/complete/route.ts
git commit -m "feat(daemon): complete endpoint supports structuredResult"
```

---

### Task 4: chat-enqueue 显式设置 taskType

**Files:**
- Modify: `src/server/ai/chat-enqueue.ts:72-80`

- [ ] **Step 1: insert 时添加 taskType: "chat"**

找到第 72 行的 `db.insert(chatTasks).values({...})`，在 `status: "queued"` 之后添加：

```typescript
taskType: "chat",
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/chat-enqueue.ts
git commit -m "feat(daemon): explicitly set taskType in chat enqueue"
```

---

### Task 5: provider.ts — generateStructuredData 走 daemon 入队

**Files:**
- Modify: `src/server/ai/provider.ts`

- [ ] **Step 1: 添加 import**

在文件顶部添加：

```typescript
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
```

- [ ] **Step 2: 替换 resolveStructuredDataMode + generateStructuredData**

删除 `resolveStructuredDataMode` 函数（约第 773-781 行），替换 `generateStructuredData` 函数为：

```typescript
/**
 * Enqueue a structured data task to the daemon queue and poll for the result.
 * The daemon CLI on the user's local machine will pick it up, run Claude CLI,
 * and push the JSON result back via /api/chat/complete.
 */
async function generateStructuredDataWithDaemon<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
}: GenerateStructuredDataOptions<TSchema>): Promise<z.infer<TSchema>> {
  const fullPrompt = buildStructuredJsonPrompt({ description, name, prompt, schema });
  const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "sonnet";

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId: "system",
    status: "queued",
    taskType: "structured",
    sourceScope: "direct",
    messages: "[]",
    systemPrompt: fullPrompt,
    model,
  });

  const POLL_INTERVAL = 300;
  const TIMEOUT = 120_000; // 2 minutes — structured tasks are slower
  const deadline = Date.now() + TIMEOUT;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await db.update(chatTasks)
        .set({ status: "cancelled" })
        .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
      throw new Error("Aborted");
    }

    const [row] = await db
      .select({
        status: chatTasks.status,
        structuredResult: chatTasks.structuredResult,
        error: chatTasks.error,
      })
      .from(chatTasks)
      .where(eq(chatTasks.id, taskId));

    if (!row) throw new Error(`Daemon task ${taskId} disappeared`);

    if (row.status === "completed" && row.structuredResult) {
      return schema.parse(JSON.parse(extractJsonObject(row.structuredResult)));
    }

    if (row.status === "failed") {
      throw new Error(row.error || `Daemon structured task failed: ${taskId}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — cancel the task
  await db.update(chatTasks)
    .set({ status: "cancelled" })
    .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
  throw new Error(`Daemon structured task timed out: ${taskId}`);
}

export async function generateStructuredData<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
}: GenerateStructuredDataOptions<TSchema>): Promise<z.infer<TSchema>> {
  const mode = getProviderMode();

  if (mode === "claude-code-daemon") {
    return generateStructuredDataWithDaemon({ description, name, prompt, schema, signal });
  }

  if (mode === "codex") {
    return generateStructuredDataWithCodex({ description, name, prompt, schema, signal });
  }

  const provider = createAiSdkProvider(mode);
  const { output } = await generateText({
    model: provider(resolveAiSdkModelId("task", mode)),
    output: Output.object({ description, name, schema }),
    prompt,
    abortSignal: signal,
  });

  return output as z.infer<TSchema>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/ai/provider.ts
git commit -m "feat(daemon): route generateStructuredData through daemon queue"
```

---

### Task 6: npm 包 — 项目结构 + package.json

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/README.md`

- [ ] **Step 1: 创建 packages/cli 目录和 package.json**

```json
{
  "name": "@knosi/cli",
  "version": "0.1.0",
  "description": "Local Claude Code daemon for Second Brain — run AI tasks on your machine",
  "license": "AGPL-3.0-or-later",
  "type": "module",
  "bin": {
    "knosi": "./src/index.mjs"
  },
  "files": [
    "src/"
  ],
  "engines": {
    "node": ">=20"
  },
  "keywords": [
    "second-brain",
    "claude",
    "ai",
    "daemon"
  ]
}
```

- [ ] **Step 2: 创建 README.md**

```markdown
# @knosi/cli

Local Claude Code daemon for [Second Brain](https://github.com/zhousiyao03-cyber/second-brain).

Runs on your machine, picks up AI tasks from the hosted Second Brain instance, executes them via your local Claude CLI, and pushes results back.

## Prerequisites

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude --version`)
- Node.js >= 20

## Usage

\`\`\`bash
npx @knosi/cli --url https://your-second-brain.vercel.app
\`\`\`

The daemon will:
1. Poll the server for queued AI tasks (chat + structured data)
2. Execute them using your local Claude CLI
3. Stream results back to the server

Press Ctrl+C to stop.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Second Brain server URL | `https://second-brain-self-alpha.vercel.app` |
| `--model <model>` | Override Claude model | (from task) |
| `--once` | Process one round then exit | `false` |
| `--claude-bin <path>` | Path to Claude CLI binary | `claude` |
\`\`\`
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json packages/cli/README.md
git commit -m "feat(cli): scaffold @knosi/cli npm package"
```

---

### Task 7: npm 包 — API 封装

**Files:**
- Create: `packages/cli/src/api.mjs`

- [ ] **Step 1: 创建 HTTP API 客户端**

```javascript
/**
 * HTTP API client — communicates with the hosted Second Brain server.
 */

let serverUrl = "";

export function configure(url) {
  serverUrl = url.replace(/\/+$/, "");
}

export async function claimTask(taskType) {
  const res = await fetch(`${serverUrl}/api/chat/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.task ?? null;
}

export async function pushChatProgress(taskId, messages) {
  if (messages.length === 0) return;
  await fetch(`${serverUrl}/api/chat/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, messages }),
  });
}

export async function completeTask(taskId, { totalText, structuredResult, error }) {
  const body = { taskId };
  if (error) {
    body.error = error;
  } else {
    if (totalText != null) body.totalText = totalText;
    if (structuredResult != null) body.structuredResult = structuredResult;
  }
  const res = await fetch(`${serverUrl}/api/chat/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Complete API ${res.status}: ${await res.text()}`);
  }
}

export async function sendHeartbeat(kind) {
  await fetch(`${serverUrl}/api/daemon/ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, version: "@knosi/cli" }),
  }).catch(() => {});
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/api.mjs
git commit -m "feat(cli): add HTTP API client module"
```

---

### Task 8: npm 包 — Claude CLI 子进程封装

**Files:**
- Create: `packages/cli/src/spawn-claude.mjs`

- [ ] **Step 1: 创建 Claude CLI wrapper**

从 `tools/usage-reporter/report.mjs` 的 `spawnClaudeForChat` 提取，新增 `spawnClaudeForStructured`：

```javascript
import { spawn as cpSpawn } from "node:child_process";

let claudeBin = "claude";

export function setClaudeBin(bin) {
  claudeBin = bin;
}

/**
 * Chat mode: streams text deltas via onText callback, returns final text.
 */
export function spawnClaudeForChat({ prompt, systemPrompt, model, onText }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--system-prompt", systemPrompt,
      "--tools", "",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    if (model) args.push("--model", model);

    const child = cpSpawn(claudeBin, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks = [];
    let finalResult = "";
    let lineBuf = "";

    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "stream_event" && event.event) {
            const se = event.event;
            if (
              se.type === "content_block_delta" &&
              se.delta?.type === "text_delta" &&
              typeof se.delta.text === "string"
            ) {
              onText(se.delta.text);
            }
            continue;
          }
          if (event.type === "result" && typeof event.result === "string") {
            finalResult = event.result;
          }
        } catch {
          // skip
        }
      }
    });

    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve(finalResult);
    });
  });
}

/**
 * Structured mode: non-streaming, returns full text result.
 */
export function spawnClaudeForStructured({ prompt, model }) {
  return new Promise((resolve, reject) => {
    const systemPrompt =
      "You are a structured data generator. Always return exactly one JSON object with no markdown fences or extra prose.";

    const args = [
      "-p", prompt,
      "--system-prompt", systemPrompt,
      "--tools", "",
      "--output-format", "json",
      "--verbose",
    ];
    if (model) args.push("--model", model);

    const child = cpSpawn(claudeBin, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks = [];
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(typeof parsed.result === "string" ? parsed.result : stdout);
      } catch {
        resolve(stdout);
      }
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/spawn-claude.mjs
git commit -m "feat(cli): add Claude CLI subprocess wrappers"
```

---

### Task 9: npm 包 — Chat 任务处理器

**Files:**
- Create: `packages/cli/src/handler-chat.mjs`

- [ ] **Step 1: 创建 handler-chat.mjs**

```javascript
import { pushChatProgress, completeTask } from "./api.mjs";
import { spawnClaudeForChat } from "./spawn-claude.mjs";

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function flattenMessagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return "";

  const history = messages.slice(0, lastUserIdx);
  const lastUser = messages[lastUserIdx];
  const currentQuestion = getMessageText(lastUser.content).trim();

  if (history.length === 0) return currentQuestion;

  const historyBlock = history
    .map((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      const text = getMessageText(m.content).trim();
      return text ? `**${role}：** ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `## 之前的对话历史\n\n${historyBlock}\n\n---\n\n## 当前问题\n\n${currentQuestion}`;
}

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function handleChatTask(task) {
  console.log(`[${ts()}] 🗨️  chat: ${task.id} (${task.model})`);

  let seq = 0;
  const pending = [];
  let flushTimer = null;

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try {
      await pushChatProgress(task.id, batch);
    } catch {
      // non-critical
    }
  }

  function onText(delta) {
    seq++;
    pending.push({ seq, type: "text_delta", delta });
    if (pending.length >= 8) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 150);
    }
  }

  try {
    const prompt = flattenMessagesToPrompt(task.messages);
    if (!prompt) throw new Error("Empty prompt from chat task messages");

    const totalText = await spawnClaudeForChat({
      prompt,
      systemPrompt: task.systemPrompt || "",
      model: task.model,
      onText,
    });

    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flush();

    await completeTask(task.id, { totalText });
    console.log(`[${ts()}] ✅ chat done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ chat failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/handler-chat.mjs
git commit -m "feat(cli): add chat task handler"
```

---

### Task 10: npm 包 — Structured 任务处理器

**Files:**
- Create: `packages/cli/src/handler-structured.mjs`

- [ ] **Step 1: 创建 handler-structured.mjs**

```javascript
import { completeTask } from "./api.mjs";
import { spawnClaudeForStructured } from "./spawn-claude.mjs";

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function handleStructuredTask(task) {
  console.log(`[${ts()}] 📦 structured: ${task.id} (${task.model})`);

  try {
    const rawText = await spawnClaudeForStructured({
      prompt: task.systemPrompt,
      model: task.model,
    });

    // Validate parseable JSON
    const trimmed = rawText.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    const jsonText = (start !== -1 && end > start)
      ? candidate.slice(start, end + 1)
      : candidate;

    JSON.parse(jsonText); // validate

    await completeTask(task.id, { structuredResult: jsonText });
    console.log(`[${ts()}] ✅ structured done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ structured failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/handler-structured.mjs
git commit -m "feat(cli): add structured data task handler"
```

---

### Task 11: npm 包 — CLI 入口

**Files:**
- Create: `packages/cli/src/index.mjs`

- [ ] **Step 1: 创建 CLI 入口**

```javascript
#!/usr/bin/env node
/**
 * @knosi/cli — Local Claude Code daemon for Second Brain
 *
 * Usage:
 *   npx @knosi/cli --url https://your-instance.vercel.app
 *   npx @knosi/cli --once
 */
import { execSync } from "node:child_process";
import { configure, claimTask, sendHeartbeat } from "./api.mjs";
import { setClaudeBin } from "./spawn-claude.mjs";
import { handleChatTask } from "./handler-chat.mjs";
import { handleStructuredTask } from "./handler-structured.mjs";

// ── Parse args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const serverUrl = getArg("--url") || "https://second-brain-self-alpha.vercel.app";
const isOnce = args.includes("--once");
const claudeBin = getArg("--claude-bin") || "claude";

const CHAT_POLL_MS = 2_000;
const STRUCTURED_POLL_MS = 1_000;
const HEARTBEAT_MS = 120_000;
const MAX_CONCURRENT_CHAT = 3;
const MAX_CONCURRENT_STRUCTURED = 5;

// ── Preflight ───────────────────────────────────────────────────────────
function checkClaude() {
  try {
    const version = execSync(`${claudeBin} --version`, { encoding: "utf8" }).trim();
    console.log(`✓ Claude CLI: ${version}`);
    return true;
  } catch {
    console.error(`✗ Claude CLI not found at "${claudeBin}"`);
    console.error("  Install: npm install -g @anthropic-ai/claude-code");
    console.error("  Or specify: --claude-bin /path/to/claude");
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────
configure(serverUrl);
setClaudeBin(claudeBin);

if (!checkClaude()) process.exit(1);

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

let chatRunning = 0;
let structuredRunning = 0;

async function pollChat() {
  if (chatRunning >= MAX_CONCURRENT_CHAT) return;
  try {
    const task = await claimTask("chat");
    if (!task) return;
    chatRunning++;
    handleChatTask(task)
      .catch(() => {})
      .finally(() => { chatRunning--; });
  } catch {
    // server unreachable
  }
}

async function pollStructured() {
  if (structuredRunning >= MAX_CONCURRENT_STRUCTURED) return;
  try {
    const task = await claimTask("structured");
    if (!task) return;
    structuredRunning++;
    handleStructuredTask(task)
      .catch(() => {})
      .finally(() => { structuredRunning--; });
  } catch {
    // server unreachable
  }
}

if (isOnce) {
  console.log("🔍 Single-run mode...");
  await pollChat();
  await pollStructured();
  console.log("Done.");
} else {
  console.log("");
  console.log("🚀 Knosi AI Daemon");
  console.log(`   Server: ${serverUrl}`);
  console.log(`   Chat poll: ${CHAT_POLL_MS / 1000}s | Structured poll: ${STRUCTURED_POLL_MS / 1000}s`);
  console.log(`   Max concurrent: chat=${MAX_CONCURRENT_CHAT} structured=${MAX_CONCURRENT_STRUCTURED}`);
  console.log("");
  console.log("   Waiting for tasks... (Ctrl+C to stop)");
  console.log("");

  // Heartbeat
  await sendHeartbeat("daemon");
  setInterval(() => sendHeartbeat("daemon"), HEARTBEAT_MS);

  // Poll loops
  setInterval(pollChat, CHAT_POLL_MS);
  setInterval(pollStructured, STRUCTURED_POLL_MS);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n[${ts()}] daemon stopped`);
      process.exit(0);
    });
  }
}
```

- [ ] **Step 2: 添加 shebang 可执行权限**

```bash
chmod +x packages/cli/src/index.mjs
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.mjs
git commit -m "feat(cli): add CLI entry point with preflight checks and poll loops"
```

---

### Task 12: 从 report.mjs 移除 chat 代码

**Files:**
- Modify: `tools/usage-reporter/report.mjs`

- [ ] **Step 1: 移除 chat 相关代码**

从 `report.mjs` 中移除：
- `CHAT_POLL_INTERVAL_MS`, `MAX_CONCURRENT_CHAT`, `HEARTBEAT_INTERVAL_MS`, `chatRunning` 变量
- `spawnClaudeForChat` 函数（约第 333-424 行）
- `getMessageText`, `flattenMessagesToPrompt` 函数（约第 588-632 行）
- `handleChatTask` 函数（约第 738-813 行）
- `pollChatTasks` 函数（约第 845-864 行）
- daemon 启动部分的 chat poll interval（约第 996-998 行）
- heartbeat 相关代码（约第 1000-1004 行）
- chat 相关的日志行

保留 `spawnClaudeCli`（分析任务用）、所有 analysis 相关代码、usage 同步代码、daily ping。

- [ ] **Step 2: 更新日志**

移除 chat 相关的启动日志行。

- [ ] **Step 3: Commit**

```bash
git add tools/usage-reporter/report.mjs
git commit -m "refactor: remove chat daemon from usage-reporter (moved to @knosi/cli)"
```

---

### Task 13: 主项目添加 daemon script（开发便利）

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 daemon script**

在 `scripts` 中添加（指向 packages/cli，开发时直接用）：

```json
"daemon": "node packages/cli/src/index.mjs"
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add pnpm daemon shortcut for local development"
```

---

### Task 14: 构建验证

**Files:** (no code changes)

- [ ] **Step 1: TypeScript 编译**

```bash
cd /Users/bytedance/second-brain/.worktrees/wip-changes
pnpm build
```

Expected: 编译成功。`provider.ts` 新增的 import 和 `chatTasks` 字段无类型错误。

- [ ] **Step 2: ESLint**

```bash
pnpm lint
```

- [ ] **Step 3: CLI 冒烟测试**

```bash
node packages/cli/src/index.mjs --once --url http://localhost:3200
```

Expected: 输出 `✓ Claude CLI: ...` + `🔍 Single-run mode...` + `Done.`（无任务可处理）。

- [ ] **Step 4: 常驻模式冒烟测试**

```bash
node packages/cli/src/index.mjs --url http://localhost:3200 &
DAEMON_PID=$!
sleep 3
kill -0 $DAEMON_PID && echo "running" || echo "crashed"
kill $DAEMON_PID
```

Expected: daemon 正常启动并存活。

---

### Task 15: 端到端验证

**Files:** (no code changes)

- [ ] **Step 1: 启动 dev server + daemon**

终端 1：
```bash
cd /Users/bytedance/second-brain/.worktrees/wip-changes
AI_PROVIDER=claude-code-daemon pnpm dev
```

终端 2：
```bash
cd /Users/bytedance/second-brain/.worktrees/wip-changes
node packages/cli/src/index.mjs --url http://localhost:3200
```

- [ ] **Step 2: 测试 Chat — Ask AI 发送消息**

浏览器中打开 `http://localhost:3200/ask`，发送一条消息。确认：
1. daemon 终端输出 `🗨️ chat: ...` 和 `✅ chat done: ...`
2. 浏览器中正常流式显示回复

- [ ] **Step 3: 测试 Structured — 触发 Focus AI 分析**

在浏览器中打开 Focus Tracker 页面，触发 AI 分类或总结。确认 daemon 终端输出 `📦 structured: ...` 和 `✅ structured done: ...`。

- [ ] **Step 4: 确认非 daemon 模式不受影响**

停止 daemon，去掉 `AI_PROVIDER=claude-code-daemon`，重启 dev server，确认 Ask AI 直接走 codex/openai/local。

---

### Task 16: Pre-merge verification

**Files:** (no code changes)

- [ ] **Step 1: 完整验证**

```bash
pnpm build && pnpm lint
```

- [ ] **Step 2: 确认所有 generateStructuredData 调用点**

在 `AI_PROVIDER=claude-code-daemon` 模式下，以下调用点应全部走 daemon：
- [ ] `focus.ts` — 3 处
- [ ] `learning-notebook.ts` — 2 处
- [ ] `portfolio.ts` — 2 处
- [ ] `api/summarize/route.ts` — 1 处
- [ ] `api/generate-lesson/route.ts` — 1 处
- [ ] `api/explore/route.ts` — 1 处

- [ ] **Step 3: 执行 `finishing-a-development-branch`**
