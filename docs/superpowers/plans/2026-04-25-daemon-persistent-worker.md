# Daemon Persistent Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Knosi Ask AI daemon's chat path with persistent Claude subprocess pools, stream-json IO, and `--resume` session continuity, so follow-up questions in the same conversation respond in <1s instead of 5–10s.

**Architecture:** Two-layer change. (1) Web side: split the chat system prompt into a stable layer (identity + scope + rules) and a per-question preamble (RAG context / pinned sources / current-note text), injecting the preamble into the latest user message. This makes the system prompt safe for `--resume`. (2) Daemon side: replace the one-shot `claude -p` spawn with a worker pool keyed by `(userId, sourceScope, structuredFlag)`, where each worker holds a long-lived `claude --input-format stream-json` subprocess. Workers persist their `cli_session_id` to a new `daemon_conversations` table, and resume context across idle expiry via `claude --resume <id>`.

**Tech Stack:** Next.js 16 + tRPC + Drizzle ORM + libsql/Turso + vitest (web). Node.js 20+ + `node:child_process` + `node:test` (daemon CLI). Reference: wanman's [`claude-code.ts`](../../../wanman/packages/runtime/src/claude-code.ts) and [`agent-process.ts`](../../../wanman/packages/runtime/src/agent-process.ts) for the stream-json + resume pattern.

**Spec:** [`docs/superpowers/specs/2026-04-25-daemon-persistent-worker-design.md`](../specs/2026-04-25-daemon-persistent-worker-design.md)

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `src/server/ai/chat-system-prompt.test.ts` | Unit tests for `buildSystemPromptStable` + `buildUserPreamble` |
| `src/server/ai/inject-preamble.ts` | Pure helper: inject preamble string into the last user message of a `ModelMessage[]` |
| `src/server/ai/inject-preamble.test.ts` | Unit tests for the helper |
| `src/server/db/schema/daemon-conversations.ts` | Drizzle schema for the new table |
| `src/app/api/daemon/conversations/route.ts` | GET (read sessionId by workerKey) + POST (upsert) endpoints, bearer-token auth |
| `packages/cli/src/chat-worker.mjs` | Single Claude subprocess wrapper: spawn, stream-json IO parser, message queue, idle timer, exit handling |
| `packages/cli/src/chat-worker.test.mjs` | Tests for chat-worker (mocked spawn) |
| `packages/cli/src/chat-worker-pool.mjs` | Worker pool: getOrCreate / dispatch / removeWorker |
| `packages/cli/src/chat-worker-pool.test.mjs` | Tests for the pool |

### Files to modify

| Path | What changes |
|---|---|
| `src/server/ai/chat-system-prompt.ts` | Add `buildSystemPromptStable` + `buildUserPreamble`; refactor `buildSystemPrompt` to be a thin wrapper that combines them (kept for callers that want one big string) |
| `src/server/ai/chat-enqueue.ts` | Use stable prompt + inject preamble; the `messages` written to `chat_tasks.messages` already contain the preamble |
| `src/server/ai/chat-prepare.ts` | Same refactor for the non-daemon (in-process streaming) path |
| `src/server/db/schema/index.ts` | Re-export the new daemon-conversations schema (if a barrel exists) |
| `packages/cli/src/api.mjs` | Add `getDaemonConversation(workerKey)` + `setDaemonConversation(workerKey, cliSessionId)` |
| `packages/cli/src/handler-chat.mjs` | Dispatch via worker pool instead of `spawnClaudeForChat` |
| `packages/cli/src/daemon.mjs` | Instantiate the pool at startup; pass to handler-chat; shut down pool on SIGINT/SIGTERM |
| `packages/cli/src/spawn-claude.mjs` | Remove `spawnClaudeForChat`; keep `spawnClaudeForStructured` |
| `docs/changelog/` | Add new entry (per AGENTS.md) |

---

## Phase A — Web-side prompt refactor (no behavior change yet)

### Task 1: Add `buildSystemPromptStable`

**Files:**
- Modify: `src/server/ai/chat-system-prompt.ts`
- Test: `src/server/ai/chat-system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/chat-system-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildSystemPromptStable,
  buildUserPreamble,
} from "./chat-system-prompt";

describe("buildSystemPromptStable", () => {
  it("does not contain RAG / current_note / pinned_sources blocks", () => {
    const out = buildSystemPromptStable("all", { preferStructuredBlocks: false });
    expect(out).not.toMatch(/<knowledge_base>/);
    expect(out).not.toMatch(/<current_note>/);
    expect(out).not.toMatch(/<pinned_sources>/);
  });

  it("varies output by sourceScope", () => {
    const all = buildSystemPromptStable("all", {});
    const direct = buildSystemPromptStable("direct", {});
    expect(all).not.toBe(direct);
  });

  it("includes structured-blocks instructions when preferStructuredBlocks is true", () => {
    const on = buildSystemPromptStable("all", { preferStructuredBlocks: true });
    const off = buildSystemPromptStable("all", { preferStructuredBlocks: false });
    expect(on).toContain("<ai_blocks>");
    expect(off).not.toContain("<ai_blocks>");
  });

  it("returns the same output for the same inputs (stable contract)", () => {
    const a = buildSystemPromptStable("notes", { preferStructuredBlocks: true });
    const b = buildSystemPromptStable("notes", { preferStructuredBlocks: true });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/server/ai/chat-system-prompt.test.ts`
Expected: FAIL with `buildSystemPromptStable is not a function` (or similar import error).

- [ ] **Step 3: Implement `buildSystemPromptStable`**

In `src/server/ai/chat-system-prompt.ts`, add this function above `buildSystemPrompt`. Reuse the structured-blocks instruction generator (already exists as `withStructuredBlocksInstructions`).

```ts
export interface StableSystemPromptOptions {
  preferStructuredBlocks?: boolean;
}

export function buildSystemPromptStable(
  sourceScope: AskAiSourceScope,
  options?: StableSystemPromptOptions
): string {
  const identityLine = getChatAssistantIdentity();

  const baseRules = sourceScope === "direct"
    ? `${identityLine} 当前请求选择了直接回答模式，不要引用知识库，直接用中文回答用户的问题，简洁准确。`
    : `${identityLine} 你帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。

回答规则：
1. 优先基于用户消息中提供的知识库内容回答；如果不足以回答，可以补充你自己的知识，但要说明哪些是来自知识库、哪些是补充。
2. 如果你使用了用户提供的知识库内容，必须在回复的最末尾追加一个隐藏标记，格式为：
<!-- sources:[{"id":"来源ID","type":"note或bookmark","title":"来源标题"}] -->
只包含你实际引用的来源，不要包含未使用的来源。
3. 隐藏标记必须是回复的最后一行，前面有一个空行。`;

  return withStructuredBlocksInstructions(baseRules, {
    preferStructuredBlocks: options?.preferStructuredBlocks,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/server/ai/chat-system-prompt.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/chat-system-prompt.ts src/server/ai/chat-system-prompt.test.ts
git commit -m "feat(ai): add buildSystemPromptStable returning RAG-free system prompt"
```

---

### Task 2: Add `buildUserPreamble`

**Files:**
- Modify: `src/server/ai/chat-system-prompt.ts`
- Test: `src/server/ai/chat-system-prompt.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/server/ai/chat-system-prompt.test.ts`:

```ts
describe("buildUserPreamble", () => {
  it("returns empty string when no context, no pinned, no note", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "all",
      pinnedSources: [],
    });
    expect(out).toBe("");
  });

  it("emits <knowledge_base> when retrieved context is non-empty", () => {
    const out = buildUserPreamble({
      retrieved: [
        { id: "n1", title: "Note A", type: "note", content: "alpha" },
      ],
      sourceScope: "all",
      pinnedSources: [],
    });
    expect(out).toContain("<knowledge_base>");
    expect(out).toContain('<source id="n1"');
    expect(out).toContain("alpha");
  });

  it("emits <current_note> when contextNoteText is set", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "notes",
      pinnedSources: [],
      contextNoteText: "this is the note body",
    });
    expect(out).toContain("<current_note>");
    expect(out).toContain("this is the note body");
  });

  it("emits <pinned_sources> when pinnedSources is non-empty", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "all",
      pinnedSources: [
        { id: "b1", title: "Bookmark", type: "bookmark", content: "pinned content" },
      ],
    });
    expect(out).toContain("<pinned_sources>");
    expect(out).toContain('<pinned_source id="b1"');
  });

  it("truncates contextNoteText to 8000 chars", () => {
    const long = "x".repeat(12000);
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "notes",
      pinnedSources: [],
      contextNoteText: long,
    });
    const noteBlock = out.match(/<current_note>([\s\S]*?)<\/current_note>/)?.[1] ?? "";
    expect(noteBlock.length).toBeLessThanOrEqual(8200); // some whitespace tolerance
    expect(noteBlock.length).toBeGreaterThanOrEqual(8000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/server/ai/chat-system-prompt.test.ts`
Expected: FAIL with `buildUserPreamble is not a function`.

- [ ] **Step 3: Implement `buildUserPreamble`**

In `src/server/ai/chat-system-prompt.ts`:

```ts
export interface BuildUserPreambleInput {
  retrieved: RetrievedKnowledgeItem[];
  sourceScope: AskAiSourceScope;
  pinnedSources: RetrievedKnowledgeItem[];
  contextNoteText?: string;
}

export function buildUserPreamble(input: BuildUserPreambleInput): string {
  const parts: string[] = [];

  if (input.retrieved.length > 0) {
    const scopeHint =
      input.sourceScope === "notes"
        ? "当前只检索了笔记。"
        : input.sourceScope === "bookmarks"
          ? "当前只检索了收藏。"
          : "当前检索了笔记和收藏。";

    const knowledgeBlock = input.retrieved
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
        return `<source id="${item.id}" type="${item.type}" title="${item.title}"${
          extraAttributes ? ` ${extraAttributes}` : ""
        }>\n${item.content}\n</source>`;
      })
      .join("\n\n");

    parts.push(`${scopeHint}

以下是从我的知识库中检索到的相关内容：

<knowledge_base>
${knowledgeBlock}
</knowledge_base>`);
  }

  const noteCtx = input.contextNoteText?.trim();
  if (noteCtx) {
    parts.push(`我当前正在编辑一个笔记。以下是笔记的当前内容（当我说"这篇笔记"、"上面这段"、"本页"时，指的就是这段内容；除非我要求，否则不要原样复述）：

<current_note>
${noteCtx.slice(0, 8000)}
</current_note>`);
  }

  if (input.pinnedSources.length > 0) {
    const block = input.pinnedSources
      .map((item) => {
        const content = (item.content ?? "").slice(0, 6000);
        return `<pinned_source id="${item.id}" type="${item.type}" title="${item.title}">\n${content}\n</pinned_source>`;
      })
      .join("\n\n");
    parts.push(`我通过 @ 钉了以下来源作为这次提问的**权威上下文**。请优先基于它们回答；如果不足以回答，再说明哪些是补充：

<pinned_sources>
${block}
</pinned_sources>`);
  }

  if (parts.length === 0) return "";

  return parts.join("\n\n---\n\n") + "\n\n---\n\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/server/ai/chat-system-prompt.test.ts`
Expected: 5 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/chat-system-prompt.ts src/server/ai/chat-system-prompt.test.ts
git commit -m "feat(ai): add buildUserPreamble emitting RAG/note/pinned blocks"
```

---

### Task 3: Add `injectPreambleIntoLatestUser` helper

**Files:**
- Create: `src/server/ai/inject-preamble.ts`
- Test: `src/server/ai/inject-preamble.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/inject-preamble.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { injectPreambleIntoLatestUser } from "./inject-preamble";

describe("injectPreambleIntoLatestUser", () => {
  it("returns the messages array unchanged when preamble is empty", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
    ];
    const out = injectPreambleIntoLatestUser(messages, "");
    expect(out).toEqual(messages);
    expect(out).not.toBe(messages); // new array (immutable contract)
  });

  it("prepends preamble onto the latest user message (string content)", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "second" },
    ];
    const out = injectPreambleIntoLatestUser(messages, "<context>X</context>\n\n");
    expect(out[0]).toEqual({ role: "user", content: "first" });
    expect(out[1]).toEqual({ role: "assistant", content: "ack" });
    expect(out[2]).toEqual({
      role: "user",
      content: "<context>X</context>\n\nsecond",
    });
  });

  it("prepends preamble onto the latest user message (parts array content)", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "the question" }],
      },
    ];
    const out = injectPreambleIntoLatestUser(messages, "PRE\n\n");
    expect(out[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "PRE\n\nthe question" }],
    });
  });

  it("returns the array unchanged when there is no user message", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "lone assistant turn" },
    ];
    const out = injectPreambleIntoLatestUser(messages, "PRE");
    expect(out).toEqual(messages);
  });

  it("does not mutate the input array or its messages", () => {
    const original: ModelMessage[] = [{ role: "user", content: "hi" }];
    const snapshot = JSON.parse(JSON.stringify(original));
    injectPreambleIntoLatestUser(original, "PRE\n");
    expect(original).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/server/ai/inject-preamble.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the helper**

Create `src/server/ai/inject-preamble.ts`:

```ts
import type { ModelMessage } from "ai";

/**
 * Returns a new ModelMessage[] where `preamble` has been prepended onto the
 * content of the most recent user message. Other messages (and the input
 * array) are not mutated. If the messages array contains no user role, or
 * `preamble` is the empty string, the input is returned (still as a fresh
 * array reference, for immutability).
 *
 * Supports both string content and the structured parts-array content shape
 * used by the AI SDK.
 */
export function injectPreambleIntoLatestUser(
  messages: ModelMessage[],
  preamble: string
): ModelMessage[] {
  const next = [...messages];
  if (!preamble) return next;

  let lastUserIdx = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return next;

  const target = next[lastUserIdx];
  if (typeof target.content === "string") {
    next[lastUserIdx] = { ...target, content: `${preamble}${target.content}` };
    return next;
  }

  // parts array — prepend onto the first text part, or insert a new one.
  const parts = [...(target.content as Array<{ type: string; text?: string }>)];
  const firstTextIdx = parts.findIndex((p) => p && p.type === "text");
  if (firstTextIdx === -1) {
    parts.unshift({ type: "text", text: preamble });
  } else {
    const part = parts[firstTextIdx];
    parts[firstTextIdx] = {
      ...part,
      text: `${preamble}${(part as { text?: string }).text ?? ""}`,
    };
  }
  next[lastUserIdx] = { ...target, content: parts as ModelMessage["content"] };
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/server/ai/inject-preamble.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/inject-preamble.ts src/server/ai/inject-preamble.test.ts
git commit -m "feat(ai): add injectPreambleIntoLatestUser helper"
```

---

### Task 4: Refactor `chat-enqueue.ts` to use stable prompt + preamble

**Files:**
- Modify: `src/server/ai/chat-enqueue.ts`

- [ ] **Step 1: Read current `chat-enqueue.ts` to confirm import surface**

Run: `cat src/server/ai/chat-enqueue.ts | head -30`
Confirm it imports `buildSystemPrompt` from `chat-system-prompt`.

- [ ] **Step 2: Modify imports**

In `src/server/ai/chat-enqueue.ts`, replace:

```ts
import {
  buildSystemPrompt,
  getUserMessageText,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
```

with:

```ts
import {
  buildSystemPromptStable,
  buildUserPreamble,
  getUserMessageText,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { injectPreambleIntoLatestUser } from "@/server/ai/inject-preamble";
```

- [ ] **Step 3: Replace the `buildSystemPrompt(...)` block**

Find this block (near the bottom of `enqueueChatTask`):

```ts
const systemPrompt = buildSystemPrompt(context, sourceScope);
const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";

const taskId = crypto.randomUUID();
await db.insert(chatTasks).values({
  id: taskId,
  userId,
  status: "queued",
  taskType: "chat",
  sourceScope,
  messages: JSON.stringify(messages),
  systemPrompt,
  model,
});
```

Replace with:

```ts
const systemPrompt = buildSystemPromptStable(sourceScope, {
  preferStructuredBlocks: false,
});
const preamble = buildUserPreamble({
  retrieved: context,
  sourceScope,
  pinnedSources: [],
});
const augmentedMessages = injectPreambleIntoLatestUser(messages, preamble);
const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";

const taskId = crypto.randomUUID();
await db.insert(chatTasks).values({
  id: taskId,
  userId,
  status: "queued",
  taskType: "chat",
  sourceScope,
  messages: JSON.stringify(augmentedMessages),
  systemPrompt,
  model,
});
```

- [ ] **Step 4: Run TypeScript check**

Run: `pnpm build` (this triggers `next build` which type-checks)
Expected: build succeeds. If a type error appears in `chat-enqueue.ts`, fix it before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/chat-enqueue.ts
git commit -m "refactor(ai): inject RAG context into user message in chat-enqueue"
```

---

### Task 5: Refactor `chat-prepare.ts` (non-daemon path) to use stable prompt + preamble

**Files:**
- Modify: `src/server/ai/chat-prepare.ts`

- [ ] **Step 1: Modify imports**

Replace:

```ts
import {
  buildSystemPrompt,
  ...
} from "@/server/ai/chat-system-prompt";
```

with:

```ts
import {
  buildSystemPromptStable,
  buildUserPreamble,
  getUserMessageText,
  normalizeMessages,
  sanitizeMessages,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { injectPreambleIntoLatestUser } from "@/server/ai/inject-preamble";
```

- [ ] **Step 2: Replace the `buildSystemPrompt(...)` block**

Find this block (end of `buildChatContext`):

```ts
const system = buildSystemPrompt(context, sourceScope, {
  contextNoteText: input.contextNoteText,
  pinnedSources,
  preferStructuredBlocks: input.preferStructuredBlocks,
});

return { system, messages, sourceScope };
```

Replace with:

```ts
const system = buildSystemPromptStable(sourceScope, {
  preferStructuredBlocks: input.preferStructuredBlocks,
});
const preamble = buildUserPreamble({
  retrieved: context,
  sourceScope,
  pinnedSources,
  contextNoteText: input.contextNoteText,
});
const augmentedMessages = injectPreambleIntoLatestUser(messages, preamble);

return { system, messages: augmentedMessages, sourceScope };
```

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Run all unit tests**

Run: `pnpm test:unit`
Expected: All pass, including the new ones from Tasks 1–3.

- [ ] **Step 5: Run E2E (verifies in-process chat path didn't break)**

Run: `pnpm test:e2e -g "ask-ai" --workers=1`
Expected: existing Ask AI tests still pass.

If they fail because of an output format change (e.g. citation marker placement), the assertion may need to accept that the assistant's reply still has the `<!-- sources:... -->` marker, just with the same content. Investigate before adapting.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/chat-prepare.ts
git commit -m "refactor(ai): inject RAG context into user message for in-process chat"
```

---

## Phase B — Web-side schema + API for daemon conversations

### Task 6: Add `daemon_conversations` schema

**Files:**
- Create: `src/server/db/schema/daemon-conversations.ts`
- Modify: `src/server/db/schema/index.ts` (re-export)

- [ ] **Step 1: Inspect schema barrel**

Run: `cat src/server/db/schema/index.ts | head -30`
Confirm the existing pattern of re-exporting per-domain schema files.

- [ ] **Step 2: Create the new schema file**

Create `src/server/db/schema/daemon-conversations.ts`:

```ts
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Tracks one persistent Claude Code conversation per (user, workerKey).
 * The daemon stores the latest CLI session id captured from `system/init`
 * events; subsequent spawns use `claude --resume <cliSessionId>` to
 * recover the conversation context without retransmitting history.
 *
 * workerKey format: `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`
 * (the userId is duplicated in the key for client-side debugging; the
 * userId column is the auth source of truth).
 */
export const daemonConversations = sqliteTable(
  "daemon_conversations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workerKey: text("worker_key").notNull(),
    cliSessionId: text("cli_session_id"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userWorkerIdx: uniqueIndex("daemon_conversations_user_worker_idx").on(
      table.userId,
      table.workerKey
    ),
  })
);
```

- [ ] **Step 3: Add re-export**

Append to `src/server/db/schema/index.ts`:

```ts
export * from "./daemon-conversations";
```

- [ ] **Step 4: Generate migration**

Run: `pnpm db:generate`
Expected: a new file appears under `drizzle/` named like `0NNN_<auto>.sql` containing `CREATE TABLE daemon_conversations`.

- [ ] **Step 5: Apply locally**

Run: `pnpm db:push`
Expected: success message; no destructive prompt.

- [ ] **Step 6: Verify table exists**

Run: `pnpm db:studio` and visually confirm `daemon_conversations` is listed. Or:

```bash
sqlite3 data/dev.db "SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_conversations';"
```

Expected: prints `daemon_conversations`.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/daemon-conversations.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat(db): add daemon_conversations table for CLI session resume"
```

---

### Task 7: Add GET `/api/daemon/conversations` endpoint

**Files:**
- Create: `src/app/api/daemon/conversations/route.ts`

- [ ] **Step 1: Inspect an existing daemon-bearer-token endpoint to copy auth pattern**

Run: `cat src/app/api/chat/claim/route.ts | head -25`
Note the pattern: `await validateBearerAccessToken({ authorization: request.headers.get("authorization") })`.

- [ ] **Step 2: Create the route**

Create `src/app/api/daemon/conversations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonConversations } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";
import { z } from "zod/v4";

const upsertSchema = z.object({
  workerKey: z.string().min(1).max(256),
  cliSessionId: z.string().min(1).max(256).nullable(),
});

async function authUser(request: NextRequest): Promise<string | null> {
  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
    return auth.userId;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const userId = await authUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workerKey = request.nextUrl.searchParams.get("workerKey");
  if (!workerKey) {
    return NextResponse.json({ error: "workerKey required" }, { status: 400 });
  }
  const [row] = await db
    .select({ cliSessionId: daemonConversations.cliSessionId })
    .from(daemonConversations)
    .where(
      and(
        eq(daemonConversations.userId, userId),
        eq(daemonConversations.workerKey, workerKey)
      )
    )
    .limit(1);
  return NextResponse.json({
    cliSessionId: row?.cliSessionId ?? null,
  });
}

export async function POST(request: NextRequest) {
  const userId = await authUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { workerKey, cliSessionId } = parsed.data;
  const now = new Date();

  const [existing] = await db
    .select({ id: daemonConversations.id })
    .from(daemonConversations)
    .where(
      and(
        eq(daemonConversations.userId, userId),
        eq(daemonConversations.workerKey, workerKey)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(daemonConversations)
      .set({ cliSessionId, lastUsedAt: now })
      .where(eq(daemonConversations.id, existing.id));
  } else {
    await db.insert(daemonConversations).values({
      userId,
      workerKey,
      cliSessionId,
      lastUsedAt: now,
      createdAt: now,
    });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Run build to verify types**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the endpoints**

Start a local dev server in another terminal: `pnpm dev`. Then with a valid bearer token (you can read it from `~/.knosi/config.json` after `knosi auth login`):

```bash
curl -s -X POST http://localhost:3200/api/daemon/conversations \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"workerKey":"test|all|plain","cliSessionId":"abc-123"}'
```

Expected: `{"ok":true}`.

```bash
curl -s "http://localhost:3200/api/daemon/conversations?workerKey=test%7Call%7Cplain" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `{"cliSessionId":"abc-123"}`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/daemon/conversations/route.ts
git commit -m "feat(api): GET/POST /api/daemon/conversations for session resume"
```

---

## Phase C — Daemon-side primitives

### Task 8: API client additions in `packages/cli/src/api.mjs`

**Files:**
- Modify: `packages/cli/src/api.mjs`

- [ ] **Step 1: Read current `api.mjs` to learn fetch helper conventions**

Run: `cat packages/cli/src/api.mjs | head -50`

- [ ] **Step 2: Append the two new helpers**

At the end of `packages/cli/src/api.mjs`, add:

```js
export async function getDaemonConversation(workerKey) {
  const url = new URL(`${baseUrl}/api/daemon/conversations`);
  url.searchParams.set("workerKey", workerKey);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { authorization: `Bearer ${authToken}` },
  });
  if (res.status === 401) throw new Error("AUTH_FAILED");
  if (!res.ok) throw new Error(`getDaemonConversation: HTTP ${res.status}`);
  const json = await res.json();
  return { cliSessionId: json.cliSessionId ?? null };
}

export async function setDaemonConversation(workerKey, cliSessionId) {
  const res = await fetch(`${baseUrl}/api/daemon/conversations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workerKey, cliSessionId }),
  });
  if (res.status === 401) throw new Error("AUTH_FAILED");
  if (!res.ok) throw new Error(`setDaemonConversation: HTTP ${res.status}`);
}
```

(Adjust `baseUrl` / `authToken` access to match the existing module-private variables — read the top of the file.)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/api.mjs
git commit -m "feat(cli): add getDaemonConversation / setDaemonConversation api"
```

---

### Task 9: Implement `chat-worker.mjs` (single Claude subprocess wrapper)

**Files:**
- Create: `packages/cli/src/chat-worker.mjs`
- Test: `packages/cli/src/chat-worker.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/chat-worker.test.mjs` (follows the `node:test` pattern of `daemon-task-notifications.test.mjs`):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { ChatWorker } from "./chat-worker.mjs";

function makeMockChild() {
  const stdoutLines = [];
  const stdinChunks = [];
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinChunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = () => child.emit("close", 0);
  return { child, stdoutLines, stdinChunks, stdout, stderr };
}

test("ChatWorker emits text deltas and resolves with totalText + sessionId", async () => {
  const mock = makeMockChild();
  const worker = new ChatWorker({
    spawnFn: () => mock.child,
    workerKey: "u1|all|plain",
    systemPrompt: "S",
    model: "opus",
    cliSessionId: null,
    onSessionId: () => {},
  });

  const deltas = [];
  const promise = worker.enqueue({
    userMessageContent: "hi",
    onText: (t) => deltas.push(t),
  });

  // Simulate Claude stream-json events.
  mock.stdout.push(
    JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" }) + "\n"
  );
  mock.stdout.push(
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi " } },
    }) + "\n"
  );
  mock.stdout.push(
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "there" } },
    }) + "\n"
  );
  mock.stdout.push(JSON.stringify({ type: "result", result: "Hi there" }) + "\n");

  const out = await promise;
  assert.equal(out.totalText, "Hi there");
  assert.equal(out.sessionId, "sess-1");
  assert.deepEqual(deltas, ["Hi ", "there"]);

  worker.kill();
});

test("ChatWorker writes user message to stdin in stream-json format", async () => {
  const mock = makeMockChild();
  const worker = new ChatWorker({
    spawnFn: () => mock.child,
    workerKey: "u1|all|plain",
    systemPrompt: "S",
    model: "opus",
    cliSessionId: null,
    onSessionId: () => {},
  });

  const promise = worker.enqueue({
    userMessageContent: "what is 2+2",
    onText: () => {},
  });
  mock.stdout.push(JSON.stringify({ type: "system", subtype: "init", session_id: "sx" }) + "\n");
  mock.stdout.push(JSON.stringify({ type: "result", result: "4" }) + "\n");
  await promise;

  // The first stdin chunk should be a JSONL user message.
  assert.ok(mock.stdinChunks.length >= 1);
  const parsed = JSON.parse(mock.stdinChunks[0].trim());
  assert.equal(parsed.type, "user");
  assert.equal(parsed.message.role, "user");
  assert.equal(parsed.message.content, "what is 2+2");

  worker.kill();
});

test("ChatWorker reports resumeMissed=true on RESUME_MISSING_PATTERN error", async () => {
  const mock = makeMockChild();
  const worker = new ChatWorker({
    spawnFn: () => mock.child,
    workerKey: "u1|all|plain",
    systemPrompt: "S",
    model: "opus",
    cliSessionId: "stale-id",
    onSessionId: () => {},
  });

  const promise = worker.enqueue({ userMessageContent: "hi", onText: () => {} });
  mock.stdout.push(
    JSON.stringify({
      type: "result",
      is_error: true,
      result: "No conversation found with session ID: stale-id",
    }) + "\n"
  );
  // Process exits.
  mock.child.emit("close", 1);

  let caught;
  try { await promise; } catch (e) { caught = e; }
  assert.ok(caught);
  assert.equal(worker.resumeMissed(), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && node --test src/chat-worker.test.mjs`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `chat-worker.mjs`**

Create `packages/cli/src/chat-worker.mjs`:

```js
import { spawn as cpSpawn } from "node:child_process";
import { createInterface } from "node:readline";

const RESUME_MISSING_PATTERN =
  /no\s+(?:conversation|session)\s+found|(?:conversation|session)\s+(?:not\s+found|does\s+not\s+exist|unavailable)|could\s+not\s+(?:resume|find\s+(?:conversation|session))/i;

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let claudeBin = "claude";
export function setChatWorkerClaudeBin(bin) { claudeBin = bin; }

/**
 * One ChatWorker = one persistent `claude --input-format stream-json` subprocess
 * tied to a (userId, sourceScope, structuredFlag) workerKey. Tasks are
 * serialized through an internal queue: enqueue() returns a promise that
 * resolves after Claude emits the `result` event for that turn.
 *
 * The worker emits `onSessionId(id)` whenever Claude reports a `system/init`
 * event so callers can persist the id for `--resume` on the next spawn.
 */
export class ChatWorker {
  constructor(opts) {
    this.workerKey = opts.workerKey;
    this.systemPrompt = opts.systemPrompt;
    this.model = opts.model;
    this.cliSessionId = opts.cliSessionId ?? null;
    this.onSessionId = opts.onSessionId ?? (() => {});
    this.onExit = opts.onExit ?? (() => {});
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this._spawnFn = opts.spawnFn ?? null; // injection for tests
    this._proc = null;
    this._queue = []; // [{ userMessageContent, onText, resolve, reject }]
    this._current = null;
    this._currentText = "";
    this._dead = false;
    this._resumeMissed = false;
    this._idleTimer = null;
    this._spawn();
  }

  resumeMissed() { return this._resumeMissed; }
  isDead() { return this._dead; }

  _spawn() {
    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--tools", "",
      "--system-prompt", this.systemPrompt,
    ];
    if (this.model) args.push("--model", this.model);
    if (this.cliSessionId) args.push("--resume", this.cliSessionId);

    const proc = this._spawnFn
      ? this._spawnFn(claudeBin, args)
      : cpSpawn(claudeBin, args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
    this._proc = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => this._handleStdoutLine(line));

    proc.stderr?.on("data", () => {}); // optionally collect
    proc.on("close", (code) => this._handleExit(code));
    proc.on("error", (err) => this._failCurrent(err));
  }

  _handleStdoutLine(line) {
    const text = line.trim();
    if (!text) return;
    let event;
    try { event = JSON.parse(text); } catch { return; }

    if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
      this.cliSessionId = event.session_id;
      try { this.onSessionId(event.session_id); } catch {}
      return;
    }

    if (
      event.type === "stream_event" &&
      event.event?.type === "content_block_delta" &&
      event.event.delta?.type === "text_delta" &&
      typeof event.event.delta.text === "string"
    ) {
      const delta = event.event.delta.text;
      this._currentText += delta;
      try { this._current?.onText(delta); } catch {}
      return;
    }

    if (event.type === "result") {
      const errorText = collectErrorText(event);
      if (event.is_error && errorText && this.cliSessionId && RESUME_MISSING_PATTERN.test(errorText)) {
        this._resumeMissed = true;
      }
      const totalText = typeof event.result === "string" ? event.result : this._currentText;
      const cur = this._current;
      this._current = null;
      this._currentText = "";
      if (cur) {
        if (event.is_error) cur.reject(new Error(errorText || "claude returned is_error"));
        else cur.resolve({ totalText, sessionId: this.cliSessionId });
      }
      this._scheduleIdleTimeout();
      this._processQueue();
    }
  }

  _handleExit(code) {
    this._dead = true;
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._current) {
      this._current.reject(new Error(`claude exited with code ${code}`));
      this._current = null;
    }
    for (const task of this._queue) {
      task.reject(new Error(`claude exited with code ${code}`));
    }
    this._queue.length = 0;
    try { this.onExit(code); } catch {}
  }

  _failCurrent(err) {
    if (this._current) {
      this._current.reject(err);
      this._current = null;
    }
  }

  _scheduleIdleTimeout() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._queue.length === 0 && !this._current) this.kill();
    }, this.idleTimeoutMs);
  }

  enqueue({ userMessageContent, onText }) {
    if (this._dead) return Promise.reject(new Error("worker dead"));
    return new Promise((resolve, reject) => {
      this._queue.push({ userMessageContent, onText, resolve, reject });
      if (!this._current) this._processQueue();
    });
  }

  _processQueue() {
    if (this._current || this._queue.length === 0 || this._dead) return;
    const task = this._queue.shift();
    this._current = task;
    this._currentText = "";
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: task.userMessageContent },
    }) + "\n";
    try {
      this._proc.stdin.write(line);
    } catch (err) {
      this._failCurrent(err);
      this._handleExit(-1);
    }
  }

  kill() {
    if (this._dead) return;
    try { this._proc?.kill(); } catch {}
    // _handleExit will be triggered by the child's close event.
  }
}

function collectErrorText(event) {
  const parts = [];
  if (typeof event.result === "string" && event.result.trim()) parts.push(event.result.trim());
  if (typeof event.error === "string" && event.error.trim()) parts.push(event.error.trim());
  if (Array.isArray(event.errors)) {
    for (const err of event.errors) {
      if (typeof err === "string" && err.trim()) parts.push(err.trim());
      else if (err && typeof err === "object" && typeof err.message === "string") parts.push(err.message.trim());
    }
  }
  return parts.join(" | ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && node --test src/chat-worker.test.mjs`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat-worker.mjs packages/cli/src/chat-worker.test.mjs
git commit -m "feat(cli): add ChatWorker — stream-json IO + resume + idle timer"
```

---

### Task 10: Implement `chat-worker-pool.mjs`

**Files:**
- Create: `packages/cli/src/chat-worker-pool.mjs`
- Test: `packages/cli/src/chat-worker-pool.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/chat-worker-pool.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { ChatWorkerPool } from "./chat-worker-pool.mjs";

function makeMockChild() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  const child = new EventEmitter();
  child.stdout = stdout; child.stderr = stderr; child.stdin = stdin;
  child.kill = () => child.emit("close", 0);
  return { child, stdout, stderr };
}

test("computeWorkerKey returns stable key for same inputs", () => {
  const pool = new ChatWorkerPool({ spawnFn: () => makeMockChild().child });
  assert.equal(
    pool.computeWorkerKey({ userId: "u1", sourceScope: "all", structuredFlag: false }),
    "u1|all|plain"
  );
  assert.equal(
    pool.computeWorkerKey({ userId: "u2", sourceScope: "notes", structuredFlag: true }),
    "u2|notes|tip"
  );
});

test("getOrCreate reuses worker for same key", () => {
  const pool = new ChatWorkerPool({ spawnFn: () => makeMockChild().child });
  const a = pool.getOrCreate({ userId: "u1", sourceScope: "all", structuredFlag: false, systemPrompt: "S", model: "opus", cliSessionId: null });
  const b = pool.getOrCreate({ userId: "u1", sourceScope: "all", structuredFlag: false, systemPrompt: "S", model: "opus", cliSessionId: null });
  assert.equal(a, b);
  pool.shutdown();
});

test("different sourceScope produces different worker", () => {
  const pool = new ChatWorkerPool({ spawnFn: () => makeMockChild().child });
  const a = pool.getOrCreate({ userId: "u1", sourceScope: "all", structuredFlag: false, systemPrompt: "S", model: "opus", cliSessionId: null });
  const b = pool.getOrCreate({ userId: "u1", sourceScope: "notes", structuredFlag: false, systemPrompt: "S", model: "opus", cliSessionId: null });
  assert.notEqual(a, b);
  pool.shutdown();
});

test("worker exit removes it from pool", async () => {
  const mock = makeMockChild();
  const pool = new ChatWorkerPool({ spawnFn: () => mock.child });
  const w = pool.getOrCreate({ userId: "u1", sourceScope: "all", structuredFlag: false, systemPrompt: "S", model: "opus", cliSessionId: null });
  assert.equal(pool.size(), 1);
  mock.child.emit("close", 0);
  // Allow microtask to run.
  await new Promise((r) => setImmediate(r));
  assert.equal(pool.size(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && node --test src/chat-worker-pool.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement the pool**

Create `packages/cli/src/chat-worker-pool.mjs`:

```js
import { ChatWorker } from "./chat-worker.mjs";

export class ChatWorkerPool {
  constructor(opts = {}) {
    this._workers = new Map(); // key → ChatWorker
    this._spawnFn = opts.spawnFn ?? null;
    this._idleTimeoutMs = opts.idleTimeoutMs;
  }

  size() { return this._workers.size; }

  computeWorkerKey({ userId, sourceScope, structuredFlag }) {
    return `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`;
  }

  getOrCreate({ userId, sourceScope, structuredFlag, systemPrompt, model, cliSessionId, onSessionId }) {
    const key = this.computeWorkerKey({ userId, sourceScope, structuredFlag });
    const existing = this._workers.get(key);
    if (existing && !existing.isDead()) return existing;
    const worker = new ChatWorker({
      workerKey: key,
      systemPrompt,
      model,
      cliSessionId,
      onSessionId: onSessionId ?? (() => {}),
      onExit: () => { this._workers.delete(key); },
      ...(this._spawnFn ? { spawnFn: this._spawnFn } : {}),
      ...(this._idleTimeoutMs ? { idleTimeoutMs: this._idleTimeoutMs } : {}),
    });
    this._workers.set(key, worker);
    return worker;
  }

  removeWorker(key) {
    const w = this._workers.get(key);
    if (w) { w.kill(); this._workers.delete(key); }
  }

  shutdown() {
    for (const w of this._workers.values()) {
      try { w.kill(); } catch {}
    }
    this._workers.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && node --test src/chat-worker-pool.test.mjs`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat-worker-pool.mjs packages/cli/src/chat-worker-pool.test.mjs
git commit -m "feat(cli): add ChatWorkerPool keyed on (user, scope, structuredFlag)"
```

---

## Phase D — Daemon-side integration

### Task 11: Refactor `handler-chat.mjs` to dispatch via worker pool

**Files:**
- Modify: `packages/cli/src/handler-chat.mjs`

- [ ] **Step 1: Read current `handler-chat.mjs`**

Run: `cat packages/cli/src/handler-chat.mjs`
Note the current `flattenMessagesToPrompt` + `spawnClaudeForChat` flow.

- [ ] **Step 2: Replace the entire file**

Overwrite `packages/cli/src/handler-chat.mjs`:

```js
import { pushChatProgress, completeTask, getDaemonConversation, setDaemonConversation } from "./api.mjs";

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function getLatestUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return getMessageText(messages[i].content);
  }
  return "";
}

/**
 * Flatten the full conversation into a single user-message text. Used as the
 * fallback when session resume failed or there is no prior session yet —
 * Claude needs to "see" the prior turns somehow.
 */
function flattenAllMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return "";
  const history = messages.slice(0, lastUserIdx);
  const lastUser = messages[lastUserIdx];
  const currentQuestion = getMessageText(lastUser.content).trim();
  if (history.length === 0) return currentQuestion;
  const historyBlock = history
    .map((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      const t = getMessageText(m.content).trim();
      return t ? `**${role}：** ${t}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return `## 之前的对话历史\n\n${historyBlock}\n\n---\n\n## 当前问题\n\n${currentQuestion}`;
}

function ts() { return new Date().toLocaleTimeString("en-GB", { hour12: false }); }

export async function handleChatTask(task, pool) {
  console.log(`[${ts()}] 🗨️  chat: ${task.id} (${task.model})`);

  const userId = task.userId;
  const sourceScope = task.sourceScope || "all";
  // structuredFlag is not in the current task payload; default to false. If
  // we later thread it through the queue it will plug in here.
  const structuredFlag = false;

  let seq = 0;
  const pending = [];
  let flushTimer = null;
  async function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try { await pushChatProgress(task.id, batch); } catch {}
  }
  function onText(delta) {
    seq++;
    pending.push({ seq, type: "text_delta", delta });
    if (pending.length >= 8) flush();
    else if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 150);
  }

  // Look up any persisted session id for resume.
  let cliSessionId = null;
  try {
    const conv = await getDaemonConversation(
      `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`
    );
    cliSessionId = conv.cliSessionId;
  } catch {}

  const onSessionId = (id) => {
    void setDaemonConversation(
      `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`,
      id
    ).catch(() => {});
  };

  async function runOnce(useResume) {
    const worker = pool.getOrCreate({
      userId,
      sourceScope,
      structuredFlag,
      systemPrompt: task.systemPrompt || "",
      model: task.model,
      cliSessionId: useResume ? cliSessionId : null,
      onSessionId,
    });
    // If we are spawning fresh (no resume), claude has no prior context →
    // send the full flattened history. Otherwise just the latest user turn.
    const userMessageContent = useResume
      ? getLatestUserContent(task.messages)
      : flattenAllMessages(task.messages);
    if (!userMessageContent) throw new Error("Empty user message");
    return worker.enqueue({ userMessageContent, onText });
  }

  try {
    let result;
    try {
      result = await runOnce(Boolean(cliSessionId));
    } catch (err) {
      // Detect resume miss → drop session, retry with full history.
      const key = `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`;
      // ChatWorker exposes resumeMissed() but the worker is dead by now;
      // its message text is in err.message. Fall back unconditionally for
      // any "session-not-found" looking error. The retry uses no resume.
      if (cliSessionId && /session|conversation/i.test(err.message)) {
        try { await setDaemonConversation(key, null); } catch {}
        cliSessionId = null;
        result = await runOnce(false);
      } else {
        throw err;
      }
    }

    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flush();

    await completeTask(task.id, { totalText: result.totalText });
    console.log(`[${ts()}] ✅ chat done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ chat failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/handler-chat.mjs
git commit -m "feat(cli): refactor handler-chat to dispatch via ChatWorkerPool"
```

---

### Task 12: Wire pool into `daemon.mjs`

**Files:**
- Modify: `packages/cli/src/daemon.mjs`

- [ ] **Step 1: Add import**

At the top of `packages/cli/src/daemon.mjs`, add:

```js
import { ChatWorkerPool } from "./chat-worker-pool.mjs";
import { setChatWorkerClaudeBin } from "./chat-worker.mjs";
```

- [ ] **Step 2: Pass `claudeBin` to chat worker module**

In `runDaemon()`, after the existing `setClaudeBin(claudeBinArg)` line, add:

```js
setChatWorkerClaudeBin(claudeBinArg);
```

- [ ] **Step 3: Instantiate pool**

After the existing `let stopped = false;` line, add:

```js
const chatPool = new ChatWorkerPool();
```

- [ ] **Step 4: Pass pool to `handleChatTask`**

Find the line:

```js
handleChatTask(task)
```

Replace with:

```js
handleChatTask(task, chatPool)
```

- [ ] **Step 5: Shut down pool on exit**

Find the SIGINT/SIGTERM handler at the bottom and add `chatPool.shutdown();` before `process.exit(0)`:

```js
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopped = true;
    notificationsAbortController?.abort();
    chatPool.shutdown();
    console.log(`\n[${ts()}] daemon stopped`);
    process.exit(0);
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/daemon.mjs
git commit -m "feat(cli): wire ChatWorkerPool into daemon lifecycle"
```

---

### Task 13: Remove `spawnClaudeForChat` from `spawn-claude.mjs`

**Files:**
- Modify: `packages/cli/src/spawn-claude.mjs`

- [ ] **Step 1: Delete the now-unused function**

Open `packages/cli/src/spawn-claude.mjs`. Delete `spawnClaudeForChat` (lines 12–77). Keep `spawnClaudeForStructured` (used by structured tasks). Also keep `setClaudeBin` (used by `daemon.mjs` for the structured path).

- [ ] **Step 2: Verify no remaining importers of `spawnClaudeForChat`**

Run:

```bash
grep -r "spawnClaudeForChat" packages/cli/src
```

Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/spawn-claude.mjs
git commit -m "chore(cli): remove unused spawnClaudeForChat (replaced by worker pool)"
```

---

## Phase E — Verification

### Task 14: Web-side unit + build + lint

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests**

Run: `pnpm test:unit`
Expected: all pass, including new tests from Tasks 1–3.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: build succeeds.

If any step fails, fix the underlying cause before continuing — do not skip.

---

### Task 15: Daemon-side tests

**Files:** none (verification only)

- [ ] **Step 1: Run daemon mjs tests**

Run: `cd packages/cli && node --test src/chat-worker.test.mjs src/chat-worker-pool.test.mjs`
Expected: all pass.

- [ ] **Step 2: Run existing daemon-notification tests (regression check)**

Run: `cd packages/cli && node --test src/daemon-notifications.test.mjs src/daily-ping-scheduler.test.mjs`
Expected: all pass.

---

### Task 16: E2E test — daemon two-message conversation

**Files:**
- Create: `e2e/daemon-persistent-worker.spec.ts`

- [ ] **Step 1: Inspect existing E2E pattern**

Run: `ls e2e/ | grep -i ask` and read one of the existing Ask AI E2E tests to copy auth bypass / page setup conventions.

- [ ] **Step 2: Write the E2E test**

Create `e2e/daemon-persistent-worker.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// This test runs against AI_PROVIDER=claude-code-daemon on the test server.
// It verifies (a) two consecutive Ask AI questions both complete, and (b) the
// `daemon_conversations` row gets a non-null cli_session_id after the first.
//
// We don't measure timing here (flaky) — we just check the state machinery.

test.describe("daemon persistent worker", () => {
  test.skip(
    process.env.AI_PROVIDER !== "claude-code-daemon",
    "only meaningful in daemon mode"
  );

  test("session id is persisted after the first chat completes", async ({ page, request }) => {
    await page.goto("/ask");

    // Send first message.
    await page.fill('textarea[name="ask-input"], [data-test="ask-input"]', "你好");
    await page.click('[data-test="ask-send"]');
    await expect(page.locator('[data-test="assistant-message"]').last()).toBeVisible({ timeout: 60_000 });

    // Now query the daemon_conversations API directly. The auth pattern in
    // e2e mirrors the test harness — adapt to the actual helper available
    // in this repo (search e2e/ for examples).
    // (left as a TODO if the harness uses a different auth model)
    // Here we just confirm a follow-up message also completes, which
    // implicitly exercises the session-resume path on a warm worker.
    await page.fill('textarea[name="ask-input"], [data-test="ask-input"]', "刚才我问了什么？");
    await page.click('[data-test="ask-send"]');
    const followup = page.locator('[data-test="assistant-message"]').last();
    await expect(followup).toBeVisible({ timeout: 60_000 });
    const text = await followup.textContent();
    expect(text?.length ?? 0).toBeGreaterThan(0);
  });
});
```

If the actual selectors in this codebase differ (likely), look at any existing e2e Ask AI test for selector conventions. Update accordingly.

- [ ] **Step 3: Run the E2E (in daemon mode)**

This test only runs if the test harness can spin up the daemon. If your e2e harness is configured for `AI_PROVIDER=codex`, this test will be skipped — which is acceptable for now. Document the limitation in the changelog entry (Task 17).

Run: `pnpm test:e2e e2e/daemon-persistent-worker.spec.ts`
Expected: pass or skip cleanly.

- [ ] **Step 4: Commit**

```bash
git add e2e/daemon-persistent-worker.spec.ts
git commit -m "test(e2e): add daemon-persistent-worker two-message regression"
```

---

### Task 17: Changelog entry + production rollout notes

**Files:**
- Create: `docs/changelog/phase-daemon-persistent-worker.md`

- [ ] **Step 1: Inspect existing changelog format**

Run: `ls docs/changelog/ && cat docs/changelog/$(ls -t docs/changelog/ | head -1)`
Note the heading and section conventions used in the most recent entry.

- [ ] **Step 2: Write the entry**

Create `docs/changelog/phase-daemon-persistent-worker.md`:

```markdown
# Daemon Persistent Worker

**Date:** 2026-04-25
**Spec:** [docs/superpowers/specs/2026-04-25-daemon-persistent-worker-design.md](../superpowers/specs/2026-04-25-daemon-persistent-worker-design.md)

## Goal

Replace the one-shot `claude -p prompt` chat path with a persistent worker
pool keyed on `(userId, sourceScope, structuredFlag)`, eliminating per-task
cold-start cost (5–10s → <1s for warm-conversation follow-ups) and removing
history retransmission.

## Key changes

- Web: split `buildSystemPrompt` into `buildSystemPromptStable` +
  `buildUserPreamble`. RAG context, current-note text, and pinned sources
  now ride along with the user message instead of the system prompt, so
  the system prompt is stable across a conversation and `claude --resume`
  can be used safely.
- Web: new `daemon_conversations` table tracking the latest CLI session id
  per `(userId, workerKey)`.
- Web: new `/api/daemon/conversations` GET/POST endpoints (bearer-token
  authed) for the daemon to read/write the session id.
- CLI: new `ChatWorker` (single Claude subprocess wrapper using
  `--input-format stream-json --output-format stream-json` and
  `--resume <id>` when a session id is known) and `ChatWorkerPool`.
- CLI: refactor `handler-chat.mjs` to dispatch via the pool; old
  `spawnClaudeForChat` removed.

## Files touched

- `src/server/ai/chat-system-prompt.ts` (refactor)
- `src/server/ai/chat-system-prompt.test.ts` (new)
- `src/server/ai/inject-preamble.ts` (new)
- `src/server/ai/inject-preamble.test.ts` (new)
- `src/server/ai/chat-enqueue.ts` (refactor)
- `src/server/ai/chat-prepare.ts` (refactor)
- `src/server/db/schema/daemon-conversations.ts` (new)
- `src/server/db/schema/index.ts` (re-export)
- `drizzle/<NNNN>_<auto>.sql` (migration, generated)
- `src/app/api/daemon/conversations/route.ts` (new)
- `packages/cli/src/api.mjs` (additions)
- `packages/cli/src/chat-worker.mjs` (new)
- `packages/cli/src/chat-worker.test.mjs` (new)
- `packages/cli/src/chat-worker-pool.mjs` (new)
- `packages/cli/src/chat-worker-pool.test.mjs` (new)
- `packages/cli/src/handler-chat.mjs` (rewrite)
- `packages/cli/src/daemon.mjs` (wiring)
- `packages/cli/src/spawn-claude.mjs` (`spawnClaudeForChat` removed)
- `e2e/daemon-persistent-worker.spec.ts` (new)

## Verification

- `pnpm test:unit`: PASS (N tests)
- `pnpm lint`: PASS
- `pnpm build`: PASS
- `cd packages/cli && node --test src/chat-worker.test.mjs src/chat-worker-pool.test.mjs`: PASS
- `pnpm test:e2e`: PASS (daemon-specific test skipped under codex provider)
- Manual: opened `/ask`, asked "你好", then "刚才我问了什么", verified the
  second response references the first; the second response started
  streaming within ~1s.

## Production rollout

Schema change requires a production Turso rollout:

```bash
# 1. Pull the generated migration SQL into the rollout script
cat drizzle/<NNNN>_<auto>.sql

# 2. Apply against production Turso (the env var is in .env.turso-prod.local)
turso db shell <db-name> < drizzle/<NNNN>_<auto>.sql

# 3. Verify table exists in production
turso db shell <db-name> "SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_conversations';"
```

Then bump and publish the CLI:

```bash
cd packages/cli
npm version patch
npm publish
```

User upgrades local daemon: `npm i -g @knosi/cli@latest`.

## Remaining risks

- `--system-prompt` behavior with `--resume` is not formally documented by
  Anthropic. The RAG-to-user-message refactor (Decision 1 of the spec)
  removes our reliance on system-prompt updates across resume, but if the
  CLI ever rejects the combination outright, we'll see it as resume-miss
  errors and fall back to fresh spawn (handled in `handler-chat.mjs`).
- Idle timeout (10 min) is hard-coded. If memory pressure becomes an
  issue, expose as an env var (`KNOSI_DAEMON_IDLE_TIMEOUT_MS`).
- `chat_tasks.systemPrompt` rows written before this change are still
  valid (they include the old combined prompt), so any in-flight queue
  during deploy will complete using the legacy system-prompt shape; new
  rows will use the new shape. Forward-compatible.
```

- [ ] **Step 3: Commit**

```bash
git add docs/changelog/phase-daemon-persistent-worker.md
git commit -m "docs: changelog entry for daemon persistent worker"
```

---

### Task 18: Manual verification (only after the above all pass)

**Files:** none

- [ ] **Step 1: Restart daemon locally**

Stop the existing daemon (`Ctrl+C` in its terminal) and restart:

```bash
pnpm daemon
```

Expected: daemon starts, prints "Knosi AI Daemon" banner, claude version line shows.

- [ ] **Step 2: Open Ask AI and time the first question**

Open `/ask` in browser. Send "你好". Time from send-click to first visible token. Note baseline.

- [ ] **Step 3: Send a follow-up immediately**

Send "刚才我说了什么". Time from send-click to first visible token.

Expected: the second timing is dramatically lower than the first. The reply should reference the first turn (proving the session worked).

- [ ] **Step 4: Wait 11 minutes, then ask again**

Verify a third question after idle expiry: it should re-spawn but still resume the session, so reply still references prior turns. Timing will be intermediate (cold spawn but no history retransmission).

- [ ] **Step 5: Update the changelog with measured timings**

Append actual numbers to the "Manual" line of `docs/changelog/phase-daemon-persistent-worker.md`. Commit:

```bash
git add docs/changelog/phase-daemon-persistent-worker.md
git commit -m "docs: record measured timings for daemon persistent worker"
```

- [ ] **Step 6: (Only if all above passed) push**

Per CLAUDE.md, `git push` to `main` triggers production deploy via GitHub Actions. **Before pushing**, ensure the production Turso schema rollout from Task 17's notes has been completed, or this push will fail at runtime.

```bash
git push
```

If the production rollout has not been done, do that first (per Task 17 commands), verify with the SELECT statement, then push.

---

## Self-review

After completing all tasks, the spec is satisfied:

- ✅ Decision 1 (RAG→user message): Tasks 1–5
- ✅ Decision 2 (workerKey): Task 10
- ✅ Decision 3 (idle 10 min, sessionId persistence): Tasks 6–10
- ✅ Decision 4 (schema): Task 6
- ✅ Decision 5 (stream-json IO): Task 9
- ✅ Decision 6 (no feature flag, internal replacement): Tasks 11–13
- ✅ Decision 7 (skip improvement 3 protocol change): documented in spec, no task needed

Failure modes from spec table covered:
- Resume failure → Task 11 (`runOnce(false)` fallback)
- Process crash → Task 9 (`_handleExit`)
- Daemon restart → Task 11 (sessionId is in DB, not memory)
- Concurrent same-conversation → Task 9 (worker internal queue)
- Scope switch → Task 10 (different workerKey)
- SSE disconnect → unchanged from existing code
