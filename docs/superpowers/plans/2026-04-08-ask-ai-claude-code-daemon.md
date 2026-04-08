# Ask AI via Local Claude Code Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Ask AI chat requests through a local daemon (the existing `usage:daemon`) that spawns `claude -p` against the user's logged-in Claude subscription, so the hosted Vercel app can use Claude without needing credentials on the server.

**Architecture:** When `AI_PROVIDER=claude-code-daemon`, `POST /api/chat` enqueues a `chat_tasks` row instead of streaming directly. The local daemon polls `/api/chat/claim` every 3s, spawns `claude -p --append-system-prompt ... --output-format stream-json`, pushes text deltas to `/api/chat/progress`, and finishes with `/api/chat/complete`. The frontend polls `/api/chat/tokens?afterSeq=N` every 300ms for pseudo-streaming. Daemon reports liveness via `/api/daemon/ping` so the UI can show a "daemon offline" banner when the background process is down.

**Tech Stack:** Next.js API Routes, Drizzle ORM (libsql/Turso), Node.js ESM daemon script, Claude CLI (native install), React 19 + Tailwind for the UI changes.

---

## File Structure

**New files:**
- `src/server/ai/chat-system-prompt.ts` — shared `buildSystemPrompt` + `normalizeMessages` + `getUserMessageText` extracted from `api/chat/route.ts`
- `src/server/ai/chat-enqueue.ts` — `enqueueChatTask({ userId, messages, sourceScope })` helper (RAG → system prompt → insert chat_tasks)
- `src/server/ai/daemon-mode.ts` — `shouldUseDaemonForChat()` helper (just reads `AI_PROVIDER`)
- `src/app/api/chat/claim/route.ts` — daemon claims oldest queued task
- `src/app/api/chat/progress/route.ts` — daemon pushes text deltas
- `src/app/api/chat/complete/route.ts` — daemon reports terminal state
- `src/app/api/chat/tokens/route.ts` — frontend polls for deltas + task status
- `src/app/api/daemon/ping/route.ts` — daemon heartbeat upsert
- `src/app/api/daemon/status/route.ts` — frontend reads latest heartbeat
- `src/app/api/config/route.ts` — frontend reads `{ chatMode: "daemon" | "stream" }`
- `src/app/api/cron/cleanup-stale-chat-tasks/route.ts` — mark `running > 10min` as failed
- `src/components/ask/use-daemon-chat.ts` — new client hook for polling-based chat
- `src/components/ask/daemon-banner.tsx` — "daemon offline" banner component

**Modified files:**
- `src/server/db/schema.ts` — append `chatTasks`, `chatMessages`, `daemonHeartbeats` tables
- `src/server/ai/provider.ts` — add `"claude-code-daemon"` to `AIProviderMode`; `getProviderMode()` detects it; `getChatAssistantIdentity()` and `getAISetupHint()` add matching copy; `generateStructuredData()` downgrades to codex-or-best-available when in daemon mode
- `src/app/api/chat/route.ts` — pull helpers out to `chat-system-prompt.ts`, add daemon branch at top of POST handler, return `{ taskId, mode: "daemon" }` JSON when daemon mode active
- `src/app/(app)/ask/page.tsx` — fetch `/api/config` once on mount, pick `useDaemonChat` vs. existing `useChat` based on `chatMode`, render `DaemonBanner` when offline
- `tools/usage-reporter/report.mjs` — add chat task poll loop, `handleChatTask`, `spawnClaudeForChat`, `flattenMessagesToPrompt`, heartbeat caller, new startup logs
- `vercel.json` — add cron entry for `/api/cron/cleanup-stale-chat-tasks` every 15 minutes
- `.env.example` — document `AI_PROVIDER=claude-code-daemon` and `CLAUDE_CODE_CHAT_MODEL`
- `README.md` + `README.zh-CN.md` — add "Using Claude via local daemon" section

**Unchanged but referenced:**
- `src/app/api/analysis/claim/route.ts` — template to mirror
- `src/app/api/analysis/progress/route.ts` — template to mirror
- `src/app/api/analysis/messages/route.ts` — template for polling endpoint

Each file has one clear responsibility; the three-way split (schema / server helpers / API routes) keeps reviewable units small.

---

### Task 1: Add schema for chat_tasks, chat_messages, daemon_heartbeats

**Files:**
- Modify: `src/server/db/schema.ts:555` (append after `analysisMessages`)

- [ ] **Step 1: Append the three new tables to schema.ts**

Append after the `analysisMessages` definition (the current last export):

```typescript
// ── Ask AI Daemon Queue ────────────────────────────

export const chatTasks = sqliteTable(
  "chat_tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    sourceScope: text("source_scope").notNull().default("all"),
    messages: text("messages").notNull(), // JSON-encoded ModelMessage[]
    systemPrompt: text("system_prompt").notNull(),
    model: text("model").notNull().default("opus"),
    totalText: text("total_text"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    statusCreatedAtIdx: uniqueIndex("chat_tasks_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id
    ),
  })
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text("task_id")
      .notNull()
      .references(() => chatTasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type", { enum: ["text_delta", "text_final", "error"] }).notNull(),
    delta: text("delta"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    taskSeqIdx: uniqueIndex("chat_messages_task_seq_idx").on(table.taskId, table.seq),
  })
);

export const daemonHeartbeats = sqliteTable("daemon_heartbeats", {
  kind: text("kind").primaryKey(), // "chat" | "analysis" | "usage"
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  version: text("version"),
});
```

Make sure the `uniqueIndex` import at the top of the file already exists — schema.ts already imports it for other tables.

- [ ] **Step 2: Generate the migration**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm db:generate
```

Expected: a new file like `drizzle/0019_<random>.sql` is created with `CREATE TABLE chat_tasks`, `CREATE TABLE chat_messages`, `CREATE TABLE daemon_heartbeats`, plus the two unique indexes. Open the generated SQL and verify it does not touch existing tables.

- [ ] **Step 3: Apply migration to local DB**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm db:push
```

Expected: "Changes applied" with the three new tables.

- [ ] **Step 4: Verify the tables exist locally**

Run:
```bash
cd /Users/bytedance/second-brain && sqlite3 data/second-brain.db ".tables" | tr ' ' '\n' | grep -E '^(chat_tasks|chat_messages|daemon_heartbeats)$'
```

Expected output (three lines):
```
chat_messages
chat_tasks
daemon_heartbeats
```

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat: add chat_tasks, chat_messages, daemon_heartbeats schema"
```

---

### Task 2: Extract shared chat helpers from api/chat/route.ts

**Files:**
- Create: `src/server/ai/chat-system-prompt.ts`
- Modify: `src/app/api/chat/route.ts` (import extracted helpers)

- [ ] **Step 1: Create chat-system-prompt.ts**

Create `src/server/ai/chat-system-prompt.ts` with this exact content:

```typescript
import {
  convertToModelMessages,
  modelMessageSchema,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod/v4";
import {
  type AskAiSourceScope,
  stripAssistantSourceMetadata,
} from "@/lib/ask-ai";
import { getChatAssistantIdentity } from "./provider";

export interface RetrievedKnowledgeItem {
  chunkId?: string;
  chunkIndex?: number;
  content: string;
  id: string;
  sectionPath?: string[];
  title: string;
  type: "note" | "bookmark";
}

const uiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.object({ type: z.string() }).passthrough()),
  })
  .passthrough();

export async function normalizeMessages(
  messages: unknown[]
): Promise<ModelMessage[]> {
  const uiMessages = z.array(uiMessageSchema).safeParse(messages);
  if (uiMessages.success) {
    return convertToModelMessages(
      uiMessages.data as Array<Omit<UIMessage, "id">>
    );
  }

  const modelMessages = z.array(modelMessageSchema).safeParse(messages);
  if (modelMessages.success) {
    return modelMessages.data;
  }

  throw new Error(
    "Invalid chat message format. Expected AI SDK UI messages or model messages."
  );
}

export function sanitizeMessages(messages: ModelMessage[]) {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    if (typeof message.content === "string") {
      return {
        ...message,
        content: stripAssistantSourceMetadata(message.content),
      };
    }

    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "text"
          ? {
              ...part,
              text: stripAssistantSourceMetadata(part.text),
            }
          : part
      ),
    };
  });
}

export function getUserMessageText(message: ModelMessage | undefined) {
  if (!message || message.role !== "user") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function buildSystemPrompt(
  context: RetrievedKnowledgeItem[],
  sourceScope: AskAiSourceScope
): string {
  const identityLine = getChatAssistantIdentity();

  if (context.length === 0) {
    if (sourceScope === "direct") {
      return `${identityLine} 当前请求选择了直接回答模式，不要引用知识库，直接用中文回答用户的问题，简洁准确。`;
    }

    return `${identityLine} 用户的知识库中没有找到相关内容，请直接用中文回答用户的问题，简洁准确。`;
  }

  const scopeHint =
    sourceScope === "notes"
      ? "当前只检索了笔记。"
      : sourceScope === "bookmarks"
        ? "当前只检索了收藏。"
        : "当前检索了笔记和收藏。";

  const knowledgeBlock = context
    .map((item) => {
      const extraAttributes = [
        item.chunkId ? `chunk_id="${item.chunkId}"` : null,
        typeof item.chunkIndex === "number"
          ? `chunk_index="${item.chunkIndex}"`
          : null,
        item.sectionPath?.length
          ? `section="${item.sectionPath.join(" > ")}"`
          : null,
      ]
        .filter(Boolean)
        .join(" ");

      return `<source id="${item.id}" type="${item.type}" title="${
        item.title
      }"${extraAttributes ? ` ${extraAttributes}` : ""}>\n${item.content}\n</source>`;
    })
    .join("\n\n");

  return `${identityLine} 你帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。

${scopeHint}

以下是从用户知识库中检索到的相关内容，请优先基于这些内容回答用户的问题：

<knowledge_base>
${knowledgeBlock}
</knowledge_base>

回答规则：
1. 优先基于知识库中的内容回答，如果知识库内容不足以回答，可以补充你自己的知识，但要说明哪些是来自知识库、哪些是补充。
2. 如果你使用了知识库中的内容，必须在回复的最末尾追加一个隐藏标记，格式为：
<!-- sources:[{"id":"来源ID","type":"note或bookmark","title":"来源标题"}] -->
只包含你实际引用的来源，不要包含未使用的来源。
3. 隐藏标记必须是回复的最后一行，前面有一个空行。`;
}
```

- [ ] **Step 2: Rewrite `src/app/api/chat/route.ts` to import the shared helpers**

Replace the top of the file down through the `getUserMessageText` function with this, leaving the rest of the file intact for now:

```typescript
import type { ModelMessage } from "ai";
import { z } from "zod/v4";
import {
  ASK_AI_SOURCE_SCOPES,
  type AskAiSourceScope,
} from "@/lib/ask-ai";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import {
  getAIErrorMessage,
  streamChatResponse,
} from "@/server/ai/provider";
import {
  buildSystemPrompt,
  getUserMessageText,
  normalizeMessages,
  sanitizeMessages,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { auth } from "@/lib/auth";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";

export const maxDuration = 30;

const chatInputSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()),
  sourceScope: z.enum(ASK_AI_SOURCE_SCOPES).optional(),
});

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];
```

Delete the now-duplicated `uiMessageSchema`, `buildSystemPrompt`, `normalizeMessages`, `sanitizeMessages`, `getUserMessageText`, and `RetrievedKnowledgeItem` interface that previously lived inline in this file.

Leave the `POST` handler body untouched in this task — we will add the daemon branch in Task 4.

- [ ] **Step 3: Build + typecheck**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build
```

Expected: Build succeeds with no new TypeScript errors. If the existing chat route still type-checks, the extraction is correct.

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/chat-system-prompt.ts src/app/api/chat/route.ts
git commit -m "refactor: extract chat system prompt helpers into shared module"
```

---

### Task 3: Add claude-code-daemon provider mode

**Files:**
- Create: `src/server/ai/daemon-mode.ts`
- Modify: `src/server/ai/provider.ts` (type, getProviderMode, identity, setup hint, generateStructuredData downgrade)

- [ ] **Step 1: Create daemon-mode.ts**

Create `src/server/ai/daemon-mode.ts` with exactly:

```typescript
/**
 * Single source of truth for whether Ask AI chat should be routed to the
 * local Claude Code daemon instead of running in-process.
 *
 * Triggered when AI_PROVIDER=claude-code-daemon.
 */
export function shouldUseDaemonForChat(): boolean {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "claude-code-daemon";
}
```

- [ ] **Step 2: Extend `AIProviderMode` in provider.ts**

In `src/server/ai/provider.ts`, change the type definition:

```typescript
type AIProviderMode = "local" | "openai" | "codex" | "claude-code-daemon";
```

- [ ] **Step 3: Update `getProviderMode()` to recognize the new mode**

Find the `getProviderMode()` function and add a branch at the top of its explicit-mode handling:

```typescript
function getProviderMode(): AIProviderMode {
  const explicitMode = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicitMode === "claude-code-daemon") {
    return "claude-code-daemon";
  }
  if (explicitMode === "codex" || explicitMode === "openai-codex") {
    return "codex";
  }
  if (explicitMode === "openai") {
    return "openai";
  }
  if (explicitMode === "local") {
    return "local";
  }

  if (hasCodexAuthProfile()) {
    return "codex";
  }

  if (resolveValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }

  return "local";
}
```

The new mode is only reached when explicitly set — we do not auto-detect it, because doing so would collide with codex auto-detection.

- [ ] **Step 4: Add a fallback mode resolver for structured data**

Just above `generateStructuredData`, add this helper:

```typescript
/**
 * When the primary mode is "claude-code-daemon", generateStructuredData
 * cannot use the daemon queue (it's synchronous background work). Fall
 * back to the same auto-detect order used when AI_PROVIDER is unset.
 */
function resolveStructuredDataMode(): Exclude<AIProviderMode, "claude-code-daemon"> {
  if (hasCodexAuthProfile()) {
    return "codex";
  }
  if (resolveValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }
  return "local";
}
```

- [ ] **Step 5: Make `generateStructuredData` use the fallback in daemon mode**

Find `generateStructuredData` and change its mode resolution:

```typescript
export async function generateStructuredData<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
}: GenerateStructuredDataOptions<TSchema>): Promise<z.infer<TSchema>> {
  const primaryMode = getProviderMode();
  const mode: Exclude<AIProviderMode, "claude-code-daemon"> =
    primaryMode === "claude-code-daemon"
      ? resolveStructuredDataMode()
      : primaryMode;

  if (mode === "codex") {
    return generateStructuredDataWithCodex({
      description,
      name,
      prompt,
      schema,
      signal,
    });
  }

  const provider = createAiSdkProvider(mode);
  const { output } = await generateText({
    model: provider(resolveAiSdkModelId("task", mode)),
    output: Output.object({
      description,
      name,
      schema,
    }),
    prompt,
    abortSignal: signal,
  });

  return output as z.infer<TSchema>;
}
```

- [ ] **Step 6: Guard `streamChatResponse` against accidentally being called in daemon mode**

Find `streamChatResponse` and add an explicit error at the top:

```typescript
export async function streamChatResponse({
  messages,
  sessionId,
  signal,
  system,
}: StreamChatOptions) {
  const mode = getProviderMode();

  if (mode === "claude-code-daemon") {
    throw new Error(
      "streamChatResponse must not be called when AI_PROVIDER=claude-code-daemon. " +
        "The chat route should have taken the daemon enqueue branch."
    );
  }

  if (mode !== "codex") {
    const provider = createAiSdkProvider(mode);
    // ... rest unchanged
```

Keep the rest of the function body exactly as it was.

- [ ] **Step 7: Add identity + hint copy**

Find `getChatAssistantIdentity()` and add a branch at the top:

```typescript
export function getChatAssistantIdentity() {
  const mode = getProviderMode();

  if (mode === "claude-code-daemon") {
    const modelId = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";
    return `你是 Second Brain 的 AI 助手，当前运行在用户本机的 Claude Code daemon（${modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明当前模型。`;
  }

  if (mode === "codex") {
    // ... existing codex branch unchanged
```

Similarly for `getAISetupHint()`:

```typescript
export function getAISetupHint() {
  const mode = getProviderMode();

  if (mode === "claude-code-daemon") {
    return "请确认本机 Claude CLI 已登录（claude login），并在本机运行 pnpm usage:daemon 以启动 Ask AI daemon 队列。";
  }

  if (mode === "codex") {
    // ... existing codex branch unchanged
```

- [ ] **Step 8: Build + lint**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build && pnpm lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/server/ai/provider.ts src/server/ai/daemon-mode.ts
git commit -m "feat: add claude-code-daemon provider mode"
```

---

### Task 4: Create chat-enqueue helper

**Files:**
- Create: `src/server/ai/chat-enqueue.ts`

- [ ] **Step 1: Create the helper**

Create `src/server/ai/chat-enqueue.ts`:

```typescript
import type { ModelMessage } from "ai";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import {
  buildSystemPrompt,
  getUserMessageText,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import type { AskAiSourceScope } from "@/lib/ask-ai";

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

interface EnqueueInput {
  userId: string;
  messages: ModelMessage[];
  sourceScope: AskAiSourceScope;
}

export async function enqueueChatTask({
  userId,
  messages,
  sourceScope,
}: EnqueueInput): Promise<{ taskId: string }> {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const userQuery = getUserMessageText(lastUserMessage);

  const skipRag =
    sourceScope === "direct" ||
    SKIP_RAG_KEYWORDS.some((keyword) => userQuery.includes(keyword));

  let context: RetrievedKnowledgeItem[] = [];

  if (!skipRag) {
    const agenticContext = await retrieveAgenticContext(userQuery, {
      scope: sourceScope,
    });

    if (agenticContext.length > 0) {
      context = agenticContext.map((item) => ({
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        content: item.content,
        id: item.sourceId,
        sectionPath: item.sectionPath,
        title: item.sourceTitle,
        type: item.sourceType,
      }));
    } else {
      const fallbackContext = await retrieveContext(userQuery, {
        scope: sourceScope,
      });
      context = fallbackContext.map((item) => ({
        content: item.content,
        id: item.id,
        title: item.title,
        type: item.type,
      }));
    }
  }

  const systemPrompt = buildSystemPrompt(context, sourceScope);
  const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId,
    status: "queued",
    sourceScope,
    messages: JSON.stringify(messages),
    systemPrompt,
    model,
  });

  return { taskId };
}
```

- [ ] **Step 2: Build**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/ai/chat-enqueue.ts
git commit -m "feat: add enqueueChatTask helper for daemon chat queue"
```

---

### Task 5: Wire daemon branch into /api/chat route

**Files:**
- Modify: `src/app/api/chat/route.ts` (POST handler top)

- [ ] **Step 1: Add imports and daemon branch**

At the top of `src/app/api/chat/route.ts`, add these imports alongside the existing ones:

```typescript
import { enqueueChatTask } from "@/server/ai/chat-enqueue";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";
```

Then, inside the `POST(req)` handler, **immediately after the body parse succeeds** (after the `parsed.success` check and the `sourceScope` resolution), insert the daemon branch. The final structure of POST should look like:

```typescript
export async function POST(req: Request) {
  // Auth bypass for E2E testing
  let userId: string | null = null;
  if (process.env.AUTH_BYPASS !== "true") {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
    const { allowed } = await checkAiRateLimit(userId);
    if (!allowed) {
      return Response.json(
        { error: "Daily AI usage limit reached. Please try again tomorrow." },
        { status: 429 }
      );
    }
  }

  const body = await req.json();
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const messages = sanitizeMessages(
      await normalizeMessages(parsed.data.messages)
    );
    const sourceScope = parsed.data.sourceScope ?? "all";

    // ─── Daemon branch ─────────────────────────────────────────────
    if (shouldUseDaemonForChat()) {
      if (!userId) {
        // AUTH_BYPASS=true path: the queue requires a userId, so reject
        // daemon mode entirely in E2E/bypass environments. Tests should
        // run with AI_PROVIDER=codex instead.
        return Response.json(
          { error: "Daemon chat mode is not available in AUTH_BYPASS environments" },
          { status: 400 }
        );
      }
      const { taskId } = await enqueueChatTask({
        userId,
        messages,
        sourceScope,
      });
      if (process.env.AUTH_BYPASS !== "true") {
        void recordAiUsage(userId).catch(() => undefined);
      }
      return Response.json({ taskId, mode: "daemon" });
    }
    // ────────────────────────────────────────────────────────────────

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const userQuery = getUserMessageText(lastUserMessage);

    const skipRag =
      sourceScope === "direct" ||
      SKIP_RAG_KEYWORDS.some((kw) => userQuery.includes(kw));
    let context: RetrievedKnowledgeItem[] = [];

    if (!skipRag) {
      // ... rest of the existing streamText path unchanged
      // (retrieveAgenticContext → retrieveContext fallback → streamChatResponse)
    }

    // ... rest of function body unchanged
  } catch (error) {
    // ... existing error handler unchanged
  }
}
```

Do not duplicate any of the streamText logic — only insert the new branch above it. Keep the existing `recordAiUsage` fire-and-forget where it was for the non-daemon path.

- [ ] **Step 2: Build + lint**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build && pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Smoke test the branch (manual)**

With a local DB, set in `.env.local`:
```
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=opus
```

Restart `pnpm dev`, open `/ask`, send a dummy message. The request will fail in the UI (polling endpoints don't exist yet) but the server log should show a successful enqueue, and:

```bash
sqlite3 data/second-brain.db "SELECT id, status, source_scope, model FROM chat_tasks ORDER BY created_at DESC LIMIT 1"
```

Expected: one row with `status=queued`, `model=opus`.

Clean up the row before moving on:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_tasks"
```

Revert `.env.local` back to `AI_PROVIDER=codex` (or your usual) before continuing development, so the rest of the tasks can be built without daemon dependencies.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: route ask AI to daemon queue when AI_PROVIDER=claude-code-daemon"
```

---

### Task 6: Create /api/chat/claim

**Files:**
- Create: `src/app/api/chat/claim/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/chat/claim/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

export async function POST() {
  const [task] = await db
    .select()
    .from(chatTasks)
    .where(eq(chatTasks.status, "queued"))
    .orderBy(chatTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  const now = new Date();

  // Atomic-ish claim: only transition if still queued
  const updated = await db
    .update(chatTasks)
    .set({ status: "running", startedAt: now })
    .where(and(eq(chatTasks.id, task.id), eq(chatTasks.status, "queued")))
    .returning({ id: chatTasks.id });

  if (updated.length === 0) {
    // Another poll claimed it between the SELECT and UPDATE. Treat as empty.
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
      systemPrompt: task.systemPrompt,
      messages: parsedMessages,
    },
  });
}
```

- [ ] **Step 2: Manually test the endpoint**

Seed a fake queued task directly via sqlite so the daemon doesn't need to exist yet:

```bash
sqlite3 data/second-brain.db "INSERT INTO chat_tasks (id, user_id, status, source_scope, messages, system_prompt, model, created_at) VALUES ('test-claim-1', (SELECT id FROM users LIMIT 1), 'queued', 'all', '[]', 'test system', 'opus', unixepoch());"
```

With `pnpm dev` running in any mode:
```bash
curl -X POST http://localhost:3200/api/chat/claim
```

Expected: JSON with `task.id = test-claim-1`, status changed to `running`.

Cleanup:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_tasks WHERE id='test-claim-1'"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/claim/route.ts
git commit -m "feat: add POST /api/chat/claim for daemon task claiming"
```

---

### Task 7: Create /api/chat/progress

**Files:**
- Create: `src/app/api/chat/progress/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/chat/progress/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { chatMessages } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    messages: Array<{
      seq: number;
      type: "text_delta" | "text_final" | "error";
      delta?: string;
    }>;
  };

  if (!body.taskId || !body.messages?.length) {
    return NextResponse.json(
      { error: "taskId and non-empty messages required" },
      { status: 400 }
    );
  }

  for (const msg of body.messages) {
    await db.insert(chatMessages).values({
      taskId: body.taskId,
      seq: msg.seq,
      type: msg.type,
      delta: msg.delta ?? null,
    });
  }

  return NextResponse.json({ status: "ok", count: body.messages.length });
}
```

- [ ] **Step 2: Manually test**

Seed a task like in Task 6 Step 2, then:

```bash
curl -X POST http://localhost:3200/api/chat/progress \
  -H "Content-Type: application/json" \
  -d '{"taskId":"test-claim-1","messages":[{"seq":1,"type":"text_delta","delta":"Hello"},{"seq":2,"type":"text_delta","delta":"Hello world"}]}'
```

Expected: `{"status":"ok","count":2}`. Verify:

```bash
sqlite3 data/second-brain.db "SELECT seq, type, delta FROM chat_messages WHERE task_id='test-claim-1' ORDER BY seq"
```

Expected output:
```
1|text_delta|Hello
2|text_delta|Hello world
```

Cleanup both tables:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_messages WHERE task_id='test-claim-1'; DELETE FROM chat_tasks WHERE id='test-claim-1';"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/progress/route.ts
git commit -m "feat: add POST /api/chat/progress for daemon text delta upload"
```

---

### Task 8: Create /api/chat/complete

**Files:**
- Create: `src/app/api/chat/complete/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/chat/complete/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    totalText?: string;
    error?: string;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const now = new Date();

  if (body.error) {
    await db
      .update(chatTasks)
      .set({
        status: "failed",
        error: body.error,
        completedAt: now,
      })
      .where(eq(chatTasks.id, body.taskId));
  } else {
    await db
      .update(chatTasks)
      .set({
        status: "completed",
        totalText: body.totalText ?? "",
        completedAt: now,
      })
      .where(eq(chatTasks.id, body.taskId));
  }

  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Manually test**

```bash
sqlite3 data/second-brain.db "INSERT INTO chat_tasks (id, user_id, status, source_scope, messages, system_prompt, model, created_at, started_at) VALUES ('test-complete-1', (SELECT id FROM users LIMIT 1), 'running', 'all', '[]', 'sys', 'opus', unixepoch(), unixepoch());"

curl -X POST http://localhost:3200/api/chat/complete \
  -H "Content-Type: application/json" \
  -d '{"taskId":"test-complete-1","totalText":"Final answer"}'
```

Expected: `{"status":"ok"}`. Verify:

```bash
sqlite3 data/second-brain.db "SELECT status, total_text, completed_at IS NOT NULL AS done FROM chat_tasks WHERE id='test-complete-1'"
```

Expected:
```
completed|Final answer|1
```

Cleanup:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_tasks WHERE id='test-complete-1'"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/complete/route.ts
git commit -m "feat: add POST /api/chat/complete for daemon terminal state"
```

---

### Task 9: Create /api/chat/tokens

**Files:**
- Create: `src/app/api/chat/tokens/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/chat/tokens/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db";
import { chatMessages, chatTasks } from "@/server/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (process.env.AUTH_BYPASS !== "true") {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

    if (!taskId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const [task] = await db
      .select({
        userId: chatTasks.userId,
        status: chatTasks.status,
        totalText: chatTasks.totalText,
        error: chatTasks.error,
      })
      .from(chatTasks)
      .where(eq(chatTasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await db
      .select({
        seq: chatMessages.seq,
        type: chatMessages.type,
        delta: chatMessages.delta,
      })
      .from(chatMessages)
      .where(
        and(eq(chatMessages.taskId, taskId), gt(chatMessages.seq, afterSeq))
      )
      .orderBy(asc(chatMessages.seq))
      .limit(500);

    return NextResponse.json({
      messages,
      status: task.status,
      totalText: task.status === "completed" ? (task.totalText ?? "") : undefined,
      error: task.status === "failed" ? (task.error ?? "") : undefined,
    });
  }

  // AUTH_BYPASS path — skip ownership check
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const [task] = await db
    .select({
      status: chatTasks.status,
      totalText: chatTasks.totalText,
      error: chatTasks.error,
    })
    .from(chatTasks)
    .where(eq(chatTasks.id, taskId));

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const messages = await db
    .select({
      seq: chatMessages.seq,
      type: chatMessages.type,
      delta: chatMessages.delta,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.taskId, taskId), gt(chatMessages.seq, afterSeq)))
    .orderBy(asc(chatMessages.seq))
    .limit(500);

  return NextResponse.json({
    messages,
    status: task.status,
    totalText: task.status === "completed" ? (task.totalText ?? "") : undefined,
    error: task.status === "failed" ? (task.error ?? "") : undefined,
  });
}
```

- [ ] **Step 2: Manually test**

Seed data:
```bash
sqlite3 data/second-brain.db <<'SQL'
INSERT INTO chat_tasks (id, user_id, status, source_scope, messages, system_prompt, model, created_at)
  VALUES ('test-tok-1', (SELECT id FROM users LIMIT 1), 'running', 'all', '[]', 'sys', 'opus', unixepoch());
INSERT INTO chat_messages (id, task_id, seq, type, delta, created_at)
  VALUES ('m1','test-tok-1',1,'text_delta','Hello',unixepoch()),
         ('m2','test-tok-1',2,'text_delta','Hello world',unixepoch());
SQL
```

With `AUTH_BYPASS=true pnpm dev`:
```bash
curl "http://localhost:3200/api/chat/tokens?taskId=test-tok-1&afterSeq=0"
```

Expected response:
```json
{"messages":[{"seq":1,"type":"text_delta","delta":"Hello"},{"seq":2,"type":"text_delta","delta":"Hello world"}],"status":"running"}
```

Test `afterSeq=1`:
```bash
curl "http://localhost:3200/api/chat/tokens?taskId=test-tok-1&afterSeq=1"
```

Expected: only seq 2.

Cleanup:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_messages WHERE task_id='test-tok-1'; DELETE FROM chat_tasks WHERE id='test-tok-1';"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/tokens/route.ts
git commit -m "feat: add GET /api/chat/tokens for frontend polling"
```

---

### Task 10: Daemon ping + status + config API routes

**Files:**
- Create: `src/app/api/daemon/ping/route.ts`
- Create: `src/app/api/daemon/status/route.ts`
- Create: `src/app/api/config/route.ts`

- [ ] **Step 1: Create `ping/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonHeartbeats } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    version?: string;
  };

  const kind = body.kind?.trim() || "chat";
  const version = body.version?.trim() || null;
  const now = new Date();

  const existing = await db
    .select({ kind: daemonHeartbeats.kind })
    .from(daemonHeartbeats)
    .where(eq(daemonHeartbeats.kind, kind));

  if (existing.length === 0) {
    await db.insert(daemonHeartbeats).values({ kind, lastSeenAt: now, version });
  } else {
    await db
      .update(daemonHeartbeats)
      .set({ lastSeenAt: now, version })
      .where(eq(daemonHeartbeats.kind, kind));
  }

  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Create `status/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonHeartbeats } from "@/server/db/schema";

const ONLINE_THRESHOLD_MS = 90 * 1000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "chat";

  const [row] = await db
    .select()
    .from(daemonHeartbeats)
    .where(eq(daemonHeartbeats.kind, kind));

  if (!row) {
    return NextResponse.json({
      online: false,
      lastSeenAt: null,
      secondsSince: null,
    });
  }

  const lastSeenMs = row.lastSeenAt.getTime();
  const ageMs = Date.now() - lastSeenMs;

  return NextResponse.json({
    online: ageMs < ONLINE_THRESHOLD_MS,
    lastSeenAt: row.lastSeenAt.toISOString(),
    secondsSince: Math.floor(ageMs / 1000),
  });
}
```

- [ ] **Step 3: Create `config/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";

export async function GET() {
  return NextResponse.json({
    chatMode: shouldUseDaemonForChat() ? "daemon" : "stream",
  });
}
```

- [ ] **Step 4: Manually test all three**

```bash
# Ping
curl -X POST http://localhost:3200/api/daemon/ping \
  -H "Content-Type: application/json" \
  -d '{"kind":"chat","version":"test-1"}'
# Expected: {"status":"ok"}

# Status
curl http://localhost:3200/api/daemon/status?kind=chat
# Expected: {"online":true,"lastSeenAt":"2026-...","secondsSince":0}

# Config (with AI_PROVIDER=codex in .env.local)
curl http://localhost:3200/api/config
# Expected: {"chatMode":"stream"}

# Set AI_PROVIDER=claude-code-daemon in .env.local, restart dev, then:
curl http://localhost:3200/api/config
# Expected: {"chatMode":"daemon"}
```

Revert `.env.local` back to your normal provider after.

Cleanup:
```bash
sqlite3 data/second-brain.db "DELETE FROM daemon_heartbeats"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/daemon/ping/route.ts src/app/api/daemon/status/route.ts src/app/api/config/route.ts
git commit -m "feat: add daemon ping/status + chat mode config endpoints"
```

---

### Task 11: Extend usage-reporter daemon with chat loop

**Files:**
- Modify: `tools/usage-reporter/report.mjs`

- [ ] **Step 1: Add constants and state at the top of the file**

Near the existing constants (around line 23 where `ANALYSIS_POLL_INTERVAL_MS` is declared), add:

```javascript
const CHAT_POLL_INTERVAL_MS = 3 * 1000; // 3 seconds
const MAX_CONCURRENT_CHAT = 3;
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
let chatRunning = 0;
```

- [ ] **Step 2: Add `flattenMessagesToPrompt` helper**

Before the `handleAnalysisTask` function, add:

```javascript
function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function flattenMessagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  // Find last user message = current question; everything before = history
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    return "";
  }

  const history = messages.slice(0, lastUserIdx);
  const lastUser = messages[lastUserIdx];
  const currentQuestion = getMessageText(lastUser.content).trim();

  if (history.length === 0) {
    return currentQuestion;
  }

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
```

- [ ] **Step 3: Add `spawnClaudeForChat`**

Right after `spawnClaudeCli` (the existing function that takes `tools`), add this new function:

```javascript
function spawnClaudeForChat({ prompt, systemPrompt, model, onText }) {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const args = [
      "-p",
      prompt,
      "--append-system-prompt",
      systemPrompt,
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    if (model) {
      args.push("--model", model);
    }
    // Intentionally no --allowedTools → Claude gets no tools, pure chat.

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

          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && typeof block.text === "string") {
                // CLI emits each assistant text block as a full string.
                // Treat it as the current cumulative text — the frontend
                // will overwrite rather than concatenate.
                onText(block.text);
              }
            }
          }

          if (event.type === "result" && typeof event.result === "string") {
            finalResult = event.result;
          }
        } catch {
          // skip unparseable lines
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
```

- [ ] **Step 4: Add `handleChatTask`**

Right after `handleAnalysisTask`, add:

```javascript
async function handleChatTask(task) {
  console.log(`[${timestamp()}] 🗨️  chat task claim: ${task.id} (${task.model})`);

  let seq = 0;
  const pending = [];
  let flushTimer = null;

  async function flushMessages() {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try {
      await fetch(`${SERVER_URL}/api/chat/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, messages: batch }),
      });
    } catch {
      // non-critical; the next flush or complete will carry forward
    }
  }

  function onText(snapshot) {
    seq++;
    pending.push({ seq, type: "text_delta", delta: snapshot });
    if (pending.length >= 8) {
      flushMessages();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushMessages();
      }, 150);
    }
  }

  try {
    const prompt = flattenMessagesToPrompt(task.messages);
    if (!prompt) {
      throw new Error("Empty prompt from chat task messages");
    }

    const totalText = await spawnClaudeForChat({
      prompt,
      systemPrompt: task.systemPrompt || "",
      model: task.model,
      onText,
    });

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // Emit final-text marker so the frontend has a clean stop signal
    seq++;
    pending.push({ seq, type: "text_final", delta: totalText });
    await flushMessages();

    const res = await fetch(`${SERVER_URL}/api/chat/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, totalText }),
    });

    if (!res.ok) {
      throw new Error(`Complete API ${res.status}: ${await res.text()}`);
    }

    console.log(`[${timestamp()}] ✅ chat task done: ${task.id}`);
  } catch (err) {
    console.error(`[${timestamp()}] ❌ chat task failed: ${task.id}`, err.message);
    await fetch(`${SERVER_URL}/api/chat/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, error: err.message }),
    }).catch(() => {});
  } finally {
    chatRunning--;
  }
}
```

- [ ] **Step 5: Add `pollChatTasks`**

Right after `pollAnalysisTasks`, add:

```javascript
async function pollChatTasks() {
  if (chatRunning >= MAX_CONCURRENT_CHAT) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/chat/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.task) return;

    chatRunning++;
    handleChatTask(data.task).catch(() => {});
  } catch {
    // server unreachable — silently skip
  }
}
```

- [ ] **Step 6: Add `heartbeat` helper**

Right after `pollChatTasks`, add:

```javascript
async function heartbeat(kind) {
  try {
    await fetch(`${SERVER_URL}/api/daemon/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, version: "usage-reporter" }),
    });
  } catch {
    // non-critical
  }
}
```

- [ ] **Step 7: Wire the new loops into the daemon main section**

In the main `} else {` branch (daemon mode, near line 616 onward), after the existing analysis polling `setInterval`, add:

```javascript
  // Chat task polling
  setInterval(async () => {
    await pollChatTasks();
  }, CHAT_POLL_INTERVAL_MS);

  // Heartbeat loop
  await heartbeat("chat");
  setInterval(() => {
    heartbeat("chat").catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
```

Also update the startup log block (where it prints the existing intervals) to include:

```javascript
  console.log(`   Chat 任务轮询间隔: ${CHAT_POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Heartbeat 间隔: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
```

- [ ] **Step 8: Manually verify the daemon runs without errors**

With no actual chat tasks queued, run:
```bash
cd /Users/bytedance/second-brain && pnpm usage:daemon
```

Expected startup output mentions `Chat 任务轮询间隔: 3s` and `Heartbeat 间隔: 30s`, and the process stays running without crashing. Let it run for a minute. Then in another terminal:

```bash
curl http://localhost:3200/api/daemon/status?kind=chat
```

Expected: `{"online":true,"lastSeenAt":"...","secondsSince":0-30}`. Ctrl+C the daemon.

- [ ] **Step 9: Commit**

```bash
git add tools/usage-reporter/report.mjs
git commit -m "feat: daemon polls chat_tasks and spawns claude -p with heartbeat"
```

---

### Task 12: Frontend — useDaemonChat hook

**Files:**
- Create: `src/components/ask/use-daemon-chat.ts`

- [ ] **Step 1: Create the hook**

Create `src/components/ask/use-daemon-chat.ts`:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";
import type { AskAiSourceScope } from "@/lib/ask-ai";

export interface DaemonUIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export type DaemonChatStatus = "idle" | "submitting" | "streaming" | "error";

interface UseDaemonChatOptions {
  api: string;
  sourceScope: AskAiSourceScope;
}

const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 120 * 1000;

export function useDaemonChat({ api, sourceScope }: UseDaemonChatOptions) {
  const [messages, setMessages] = useState<DaemonUIMessage[]>([]);
  const [status, setStatus] = useState<DaemonChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setError(null);
    cancelRef.current = false;
  }, []);

  const stop = useCallback(() => {
    cancelRef.current = true;
    setStatus("idle");
  }, []);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (status !== "idle") {
        return;
      }

      cancelRef.current = false;
      setError(null);

      const userMsg: DaemonUIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setStatus("submitting");

      try {
        const enqueueRes = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.map((m) => ({
              role: m.role,
              parts: m.parts,
            })),
            sourceScope,
          }),
        });

        if (!enqueueRes.ok) {
          const body = await enqueueRes.json().catch(() => ({}));
          throw new Error(body.error || `Chat enqueue failed: ${enqueueRes.status}`);
        }

        const enqueueBody = (await enqueueRes.json()) as {
          taskId?: string;
          mode?: string;
          error?: string;
        };

        if (!enqueueBody.taskId || enqueueBody.mode !== "daemon") {
          throw new Error(
            enqueueBody.error ||
              "Chat endpoint did not return a daemon taskId (is AI_PROVIDER=claude-code-daemon?)"
          );
        }

        const taskId = enqueueBody.taskId;
        const assistantId = crypto.randomUUID();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", parts: [{ type: "text", text: "" }] },
        ]);
        setStatus("streaming");

        let lastSeq = 0;
        let currentText = "";
        const startedAt = Date.now();

        while (true) {
          if (cancelRef.current) {
            // User asked us to stop local polling; leave daemon task alone
            return;
          }

          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            throw new Error(
              "Daemon task did not finish within 2 minutes. The local daemon may be offline."
            );
          }

          const tokenRes = await fetch(
            `/api/chat/tokens?taskId=${encodeURIComponent(taskId)}&afterSeq=${lastSeq}`
          );

          if (!tokenRes.ok) {
            throw new Error(`Token poll failed: ${tokenRes.status}`);
          }

          const tokenBody = (await tokenRes.json()) as {
            messages: Array<{
              seq: number;
              type: "text_delta" | "text_final" | "error";
              delta: string | null;
            }>;
            status: "queued" | "running" | "completed" | "failed";
            totalText?: string;
            error?: string;
          };

          for (const m of tokenBody.messages) {
            lastSeq = Math.max(lastSeq, m.seq);
            if ((m.type === "text_delta" || m.type === "text_final") && m.delta != null) {
              // CLI emits full-text snapshots — overwrite, not append
              currentText = m.delta;
            }
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, parts: [{ type: "text", text: currentText }] }
                : msg
            )
          );

          if (tokenBody.status === "completed") {
            if (tokenBody.totalText && tokenBody.totalText !== currentText) {
              currentText = tokenBody.totalText;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, parts: [{ type: "text", text: currentText }] }
                    : msg
                )
              );
            }
            setStatus("idle");
            return;
          }

          if (tokenBody.status === "failed") {
            throw new Error(tokenBody.error || "Daemon task failed");
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [api, messages, sourceScope, status]
  );

  return { messages, status, error, sendMessage, stop, reset };
}
```

- [ ] **Step 2: Build + typecheck**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/use-daemon-chat.ts
git commit -m "feat: add useDaemonChat hook for polling-based chat streaming"
```

---

### Task 13: Frontend — daemon offline banner component

**Files:**
- Create: `src/components/ask/daemon-banner.tsx`

- [ ] **Step 1: Create the banner**

Create `src/components/ask/daemon-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface DaemonStatus {
  online: boolean;
  lastSeenAt: string | null;
  secondsSince: number | null;
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return "从未";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function DaemonBanner() {
  const [statusData, setStatusData] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/daemon/status?kind=chat");
        if (!res.ok) return;
        const data = (await res.json()) as DaemonStatus;
        if (!cancelled) setStatusData(data);
      } catch {
        // ignore — banner just stays hidden
      }
    }

    refresh();
    const id = setInterval(refresh, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!statusData || statusData.online) {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <strong>本地 Claude daemon 未运行</strong> — Ask AI 依赖本机 daemon
      调用 Claude CLI，请在本机运行 <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/60">pnpm usage:daemon</code>。
      最后心跳：{formatAge(statusData.secondsSince)}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/daemon-banner.tsx
git commit -m "feat: add DaemonBanner showing daemon liveness"
```

---

### Task 14: Wire daemon mode into /ask page

**Files:**
- Modify: `src/app/(app)/ask/page.tsx`

- [ ] **Step 1: Add chat mode detection**

At the top of `src/app/(app)/ask/page.tsx`, add imports:

```typescript
import { useDaemonChat } from "@/components/ask/use-daemon-chat";
import { DaemonBanner } from "@/components/ask/daemon-banner";
```

Inside the `AskPage` component (or whatever the default exported component is called), near the other state hooks, add:

```typescript
const [chatMode, setChatMode] = useState<"daemon" | "stream" | null>(null);

useEffect(() => {
  let cancelled = false;
  fetch("/api/config")
    .then((res) => res.json())
    .then((data) => {
      if (!cancelled) {
        setChatMode(data.chatMode === "daemon" ? "daemon" : "stream");
      }
    })
    .catch(() => {
      if (!cancelled) setChatMode("stream");
    });
  return () => {
    cancelled = true;
  };
}, []);
```

- [ ] **Step 2: Branch between the two hooks**

Find the existing `useChat(...)` call. Wrap the component's chat state logic in a mode check. The simplest approach: split the page body into two subtrees based on `chatMode`.

At the place where `useChat` is called, restructure so the page renders `null` while `chatMode` is still loading, then renders one of two child components:

```typescript
if (chatMode === null) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-stone-500">
      Loading...
    </div>
  );
}

if (chatMode === "daemon") {
  return <AskPageDaemon sourceScope={sourceScope} setSourceScope={setSourceScope} />;
}

return <AskPageStream sourceScope={sourceScope} setSourceScope={setSourceScope} />;
```

(The scope state can hoist up or be duplicated inside each child; duplication is fine given the page is single-use.)

Move the current `useChat`-based rendering into a new function `AskPageStream(...)` at the bottom of the same file, keeping its internals identical.

Create a new function `AskPageDaemon(...)` that mirrors `AskPageStream` but uses `useDaemonChat` instead:

```tsx
function AskPageDaemon({
  sourceScope,
  setSourceScope,
}: {
  sourceScope: AskAiSourceScope;
  setSourceScope: (scope: AskAiSourceScope) => void;
}) {
  const { messages, status, error, sendMessage } = useDaemonChat({
    api: "/api/chat",
    sourceScope,
  });
  const [input, setInput] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== "idle") return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="flex h-full flex-col">
      <DaemonBanner />
      {/* Reuse the same chat transcript + composer markup as AskPageStream,
          adapting props:
          - Iterate `messages` and render each via parseAssistantResponse for assistant
            parts (use `getMessageText(parts)` equivalent: m.parts[0]?.text ?? "")
          - Disable the submit button when status !== "idle"
          - Show error.message in a toast if error is non-null
      */}
    </div>
  );
}
```

**Important:** do not leave the "Reuse the same chat transcript" comment as the only content. The concrete step-by-step recipe is:

1. Copy the entire body of the existing `AskPage` component's return statement (the JSX tree containing the transcript list, source chips, composer form, and quick prompts) into `AskPageDaemon`.

2. In the pasted JSX, make exactly these replacements (semantic diff):
   - Wherever it reads `message.parts` from `useChat`'s `messages`, keep the same structure. `useDaemonChat` emits messages in the exact shape `{ id, role, parts: [{ type: "text", text }] }`, so the rendering loop works without modification.
   - For assistant messages, keep the existing `const text = getMessageText(message.parts)` + `parseAssistantResponse(text)` pipeline (both helpers are already imported at the top of `ask/page.tsx`).
   - Replace `const { messages, status, sendMessage, stop, error } = useChat({...})` with `const { messages, status, sendMessage, stop, error } = useDaemonChat({ api: "/api/chat", sourceScope })`.
   - Replace the `useChat` `sendMessage({ text })` call inside the submit handler (it already takes `{ text }`, so the call site stays the same).
   - The existing stop button checks `status === "streaming"`. `useDaemonChat` also returns `status === "streaming"` while polling, so the button condition stays.
   - The existing error banner reads `error?.message` — keep it.
   - Delete any code inside `AskPageStream` that reads `TextStreamChatTransport` or other `@ai-sdk/react` transport internals if it exists outside the `useChat(...)` call itself. There should be no such code in the daemon path.

3. At the very top of the `AskPageDaemon` return, insert `<DaemonBanner />` as the first child inside the outermost wrapper.

The duplication between `AskPageStream` and `AskPageDaemon` is ~40-60 lines of JSX and is explicitly accepted: the two modes have subtly different hook return shapes and merging them would produce a worse component.

- [ ] **Step 3: Build + lint**

Run:
```bash
cd /Users/bytedance/second-brain && pnpm build && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/ask/page.tsx
git commit -m "feat: ask page switches between stream and daemon modes via /api/config"
```

---

### Task 15: Stale task cleanup cron

**Files:**
- Create: `src/app/api/cron/cleanup-stale-chat-tasks/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/cleanup-stale-chat-tasks/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threshold = new Date(Date.now() - STALE_RUNNING_MS);

  const stale = await db
    .select({ id: chatTasks.id })
    .from(chatTasks)
    .where(and(eq(chatTasks.status, "running"), lt(chatTasks.startedAt, threshold)));

  for (const row of stale) {
    await db
      .update(chatTasks)
      .set({
        status: "failed",
        error: "Task stalled (daemon crash or lost connection)",
        completedAt: new Date(),
      })
      .where(eq(chatTasks.id, row.id));
  }

  return NextResponse.json({ cleaned: stale.length });
}
```

- [ ] **Step 2: Add the cron to vercel.json**

Edit `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/portfolio-news",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/cleanup-stale-chat-tasks",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Manually test the cleanup**

Seed a stale running task:
```bash
sqlite3 data/second-brain.db "INSERT INTO chat_tasks (id, user_id, status, source_scope, messages, system_prompt, model, created_at, started_at) VALUES ('test-stale-1', (SELECT id FROM users LIMIT 1), 'running', 'all', '[]', 'sys', 'opus', unixepoch() - 1200, unixepoch() - 1200);"
```

Call the endpoint:
```bash
curl http://localhost:3200/api/cron/cleanup-stale-chat-tasks
```

Expected: `{"cleaned":1}` (assuming no CRON_SECRET in local env). Verify:

```bash
sqlite3 data/second-brain.db "SELECT status, error FROM chat_tasks WHERE id='test-stale-1'"
```

Expected:
```
failed|Task stalled (daemon crash or lost connection)
```

Cleanup:
```bash
sqlite3 data/second-brain.db "DELETE FROM chat_tasks WHERE id='test-stale-1'"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/cleanup-stale-chat-tasks/route.ts vercel.json
git commit -m "feat: cron cleans up stale running chat_tasks after 10 minutes"
```

---

### Task 16: Update .env.example and README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add env vars to .env.example**

Append to `.env.example`:

```bash
# ── Ask AI daemon mode (optional) ─────────────────────
# When set, POST /api/chat enqueues to chat_tasks and the local
# usage daemon (pnpm usage:daemon) spawns `claude -p` using your
# local Claude subscription. Requires `claude login` to have run.
# AI_PROVIDER=claude-code-daemon
# CLAUDE_CODE_CHAT_MODEL=opus
```

- [ ] **Step 2: Add README section**

Add a new section to `README.md`, just before the "Common Commands" heading:

```markdown
## Using Claude Subscription via Local Daemon

If you have a Claude Pro/Max subscription and want to use it for Ask AI (instead of paying for the OpenAI API), set:

```bash
# .env.local
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=opus  # or sonnet
```

Then run the daemon in a separate terminal:

```bash
pnpm usage:daemon
```

The daemon polls `/api/chat/claim` every 3 seconds, spawns `claude -p` locally using your logged-in session, and streams results back. This works identically against local dev (`localhost:3200`) and the hosted Vercel deployment — as long as the daemon is running on your machine, any browser you open can use Claude.

When the daemon is not running, `/ask` shows a banner. Stop it with Ctrl+C.

Requires:
- Claude CLI installed and `claude login` completed once
- `pnpm usage:daemon` running on the machine with your Claude credentials
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document claude-code-daemon provider mode"
```

---

### Task 17: Local smoke test end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Confirm Claude CLI is installed and logged in**

Run:
```bash
claude --version
```

Expected: version string. If not installed, install per Anthropic docs, then `claude login`.

- [ ] **Step 2: Set env for daemon mode**

Edit `.env.local`:
```bash
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=opus
```

- [ ] **Step 3: Start dev server**

Terminal A:
```bash
cd /Users/bytedance/second-brain && pnpm dev
```

Wait for "ready" on port 3200.

- [ ] **Step 4: Start daemon**

Terminal B:
```bash
cd /Users/bytedance/second-brain && pnpm usage:daemon
```

Expected startup includes:
- `Chat 任务轮询间隔: 3s`
- `Heartbeat 间隔: 30s`

- [ ] **Step 5: Verify daemon status endpoint**

Terminal C:
```bash
curl http://localhost:3200/api/daemon/status?kind=chat
```

Expected: `{"online":true, ...}`.

- [ ] **Step 6: Verify config endpoint reports daemon mode**

```bash
curl http://localhost:3200/api/config
```

Expected: `{"chatMode":"daemon"}`.

- [ ] **Step 7: Ask a real question via the UI**

Open `http://localhost:3200/ask` in a browser. Log in if needed. Verify:
- **No** daemon offline banner at the top.
- Send the question: `"请用一句话介绍自己。"`
- Within ~3 seconds, text begins to appear.
- The full response arrives and streaming stops.
- Daemon Terminal B shows `🗨️ chat task claim: ...` then `✅ chat task done: ...`.

- [ ] **Step 8: Verify daemon offline handling**

- Stop the daemon in Terminal B with Ctrl+C.
- Wait 90+ seconds.
- Refresh `/ask` in the browser.
- Expected: the amber banner `"本地 Claude daemon 未运行"` appears at the top.
- Send another question.
- Expected: after ~2 minutes the UI shows a timeout error. `sqlite3 data/second-brain.db "SELECT status FROM chat_tasks ORDER BY created_at DESC LIMIT 1"` should show `queued`.
- Manually set it to `failed` and cleanup: `sqlite3 data/second-brain.db "UPDATE chat_tasks SET status='failed' WHERE status='queued'"`
- Restart the daemon; send another question; should complete normally.

- [ ] **Step 9: Verify the non-daemon path is not broken**

- Stop Terminal A (dev server).
- Edit `.env.local`: `AI_PROVIDER=codex` (or whatever you normally use).
- Restart `pnpm dev`.
- `curl http://localhost:3200/api/config` → `{"chatMode":"stream"}`.
- Open `/ask`, send a question. Expected: streams as before via `useChat` + `TextStreamChatTransport`.
- Banner should not appear.
- Stop the dev server.

- [ ] **Step 10: Run build + lint**

```bash
cd /Users/bytedance/second-brain && pnpm build && pnpm lint
```

Expected: zero errors.

- [ ] **Step 11: Run the existing E2E suite**

```bash
cd /Users/bytedance/second-brain && pnpm test:e2e
```

Expected: all existing tests still pass. The E2E suite does not exercise daemon mode (intentionally).

- [ ] **Step 12: Add changelog entry**

Create `docs/changelog/2026-04-08-ask-ai-claude-code-daemon.md` with:

```markdown
# Ask AI via local Claude Code daemon — 2026-04-08

## 任务
让 Ask AI 通过用户本机的 Claude 订阅回答问题，即使访问线上 Vercel 网页也一样。

## 关键改动
- 新增 schema：`chat_tasks` / `chat_messages` / `daemon_heartbeats`
- 新增 provider mode `claude-code-daemon`（`src/server/ai/provider.ts`、`daemon-mode.ts`）
- 新增 API 路由：`/api/chat/claim`、`/api/chat/progress`、`/api/chat/complete`、`/api/chat/tokens`、`/api/daemon/ping`、`/api/daemon/status`、`/api/config`、`/api/cron/cleanup-stale-chat-tasks`
- 抽出 `src/server/ai/chat-system-prompt.ts` 共享 RAG system prompt 构造
- 新增 `src/server/ai/chat-enqueue.ts` 入队 helper
- `/api/chat/route.ts` 新增 daemon 分支
- daemon (`tools/usage-reporter/report.mjs`) 新增 chat 任务循环、`handleChatTask`、`spawnClaudeForChat`、`flattenMessagesToPrompt`、心跳
- 前端：`useDaemonChat` hook、`DaemonBanner` 组件、`/ask` page 按 `/api/config` 分叉
- `vercel.json` 加定时清理 cron；README + `.env.example` 文档

## 验证
- `pnpm build` / `pnpm lint` 通过
- 本地 `AI_PROVIDER=claude-code-daemon` + `pnpm usage:daemon` 端到端跑通：真实 Claude 回答出现在 UI 中
- 停 daemon 90 秒后横幅出现；重启后新问题可被处理
- `AI_PROVIDER=codex` 切回后原 streamText 路径不受影响
- 现有 E2E 套件全部通过（daemon 模式不在 E2E 覆盖范围）

## 剩余风险 / 后续
- 生产 Turso schema rollout 见 Task 18
- 无 Cancel API（第一版），前端 stop 只停 polling，daemon 还会跑完
- CLI 每个 text block 是"全量快照"而非严格 delta —— 前端对应用 overwrite 策略
```

- [ ] **Step 13: Commit**

```bash
git add docs/changelog/2026-04-08-ask-ai-claude-code-daemon.md
git commit -m "docs: changelog for claude-code-daemon integration"
```

---

### Task 18: Production schema rollout

**Files:** none (production DB work)

- [ ] **Step 1: Dump the new migration SQL for review**

Find the migration file generated in Task 1 (the highest-numbered `drizzle/NNNN_*.sql`). Read it end-to-end. Expected content: three `CREATE TABLE` statements and two `CREATE UNIQUE INDEX` statements. No `DROP`, no `ALTER`, no reference to existing tables.

If the file also touches unrelated tables, stop and investigate — drizzle-kit sometimes bundles schema drift fixes. Only proceed with the clean 3-table migration.

- [ ] **Step 2: Copy the three-table SQL into a rollout script**

Create `scripts/db/2026-04-08-chat-daemon-schema.sql` (directory may need creating):

```bash
mkdir -p /Users/bytedance/second-brain/scripts/db
```

Paste only the 3 `CREATE TABLE` + 2 `CREATE UNIQUE INDEX` statements from the generated drizzle migration into that file.

- [ ] **Step 3: Run the script against Turso production**

Assuming the user has Turso CLI set up for the production DB:

```bash
turso db shell second-brain < /Users/bytedance/second-brain/scripts/db/2026-04-08-chat-daemon-schema.sql
```

Expected: no errors. If any `CREATE TABLE` fails with "already exists", confirm manually that the existing production table matches the new schema — if yes, skip; if no, stop and investigate.

- [ ] **Step 4: Verify production tables exist**

```bash
turso db shell second-brain "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_tasks','chat_messages','daemon_heartbeats') ORDER BY name"
```

Expected output:
```
chat_messages
chat_tasks
daemon_heartbeats
```

Also verify the indexes:
```bash
turso db shell second-brain "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('chat_tasks_status_created_idx','chat_messages_task_seq_idx') ORDER BY name"
```

Expected:
```
chat_messages_task_seq_idx
chat_tasks_status_created_idx
```

- [ ] **Step 5: Configure Vercel env vars**

Via Vercel dashboard or CLI:
```bash
vercel env add AI_PROVIDER production
# Enter: claude-code-daemon
vercel env add CLAUDE_CODE_CHAT_MODEL production
# Enter: opus
```

- [ ] **Step 6: Redeploy**

```bash
cd /Users/bytedance/second-brain && vercel deploy --prod
```

Or push to main if auto-deploy is set up.

- [ ] **Step 7: Verify config endpoint in production**

```bash
curl https://second-brain-self-alpha.vercel.app/api/config
```

Expected: `{"chatMode":"daemon"}`.

- [ ] **Step 8: Point local daemon at production and smoke test**

Start daemon with production URL:
```bash
SECOND_BRAIN_URL=https://second-brain-self-alpha.vercel.app pnpm usage:daemon
```

Open https://second-brain-self-alpha.vercel.app/ask in a browser, log in, send a question. Expected: real Claude response streamed via polling. Daemon terminal shows claim + complete logs.

Stop the daemon; wait 90s; refresh the page; verify the offline banner appears.

- [ ] **Step 9: Append production rollout result to changelog**

Edit `docs/changelog/2026-04-08-ask-ai-claude-code-daemon.md` and append:

```markdown
## Production rollout — 2026-04-08

- Applied `scripts/db/2026-04-08-chat-daemon-schema.sql` via `turso db shell second-brain`
- Verified tables: `chat_tasks`, `chat_messages`, `daemon_heartbeats`
- Verified indexes: `chat_tasks_status_created_idx`, `chat_messages_task_seq_idx`
- Vercel env set: `AI_PROVIDER=claude-code-daemon`, `CLAUDE_CODE_CHAT_MODEL=opus`
- Deployed and smoke-tested: asked "请用一句话介绍自己" from the hosted URL → Claude responded via local daemon → banner appeared when daemon stopped
```

- [ ] **Step 10: Commit**

```bash
git add scripts/db/2026-04-08-chat-daemon-schema.sql docs/changelog/2026-04-08-ask-ai-claude-code-daemon.md
git commit -m "chore: production rollout for chat daemon schema"
```

---

## Self-Review Notes

(Run by the plan author before handoff — these are done.)

**Spec coverage:**
- Schema (chat_tasks/chat_messages/daemon_heartbeats) — Task 1
- `AIProviderMode` extension + getProviderMode + guards — Task 3
- `generateStructuredData` downgrade — Task 3 Step 5
- `chat-system-prompt.ts` extraction — Task 2
- `enqueueChatTask` — Task 4
- `/api/chat` daemon branch — Task 5
- `/api/chat/claim` — Task 6
- `/api/chat/progress` — Task 7
- `/api/chat/complete` — Task 8
- `/api/chat/tokens` (with ownership check) — Task 9
- `/api/daemon/ping` + `/api/daemon/status` + `/api/config` — Task 10
- Daemon chat loop, spawn, flatten, heartbeat — Task 11
- `useDaemonChat` hook — Task 12
- `DaemonBanner` component — Task 13
- `/ask` page mode branch — Task 14
- Stale task cron — Task 15
- `.env.example` + README — Task 16
- Local smoke + changelog — Task 17
- Production rollout — Task 18

**Placeholder scan:** clean; Task 14 Step 2 includes explicit guidance that the JSX must be copied rather than left as a TODO comment.

**Type consistency:** `chatTasks.status` enum matches enqueue insert (`"queued"`), claim transition (`"running"`), complete paths (`"completed"`/`"failed"`). `chat_messages.type` enum matches daemon emits (`"text_delta"`, `"text_final"`) and frontend consumer. `AskAiSourceScope` flows through enqueue → daemon → frontend unchanged. `POST /api/chat` response shape `{taskId, mode}` matches hook consumer.
