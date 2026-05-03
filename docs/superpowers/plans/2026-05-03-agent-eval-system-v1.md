# Agent Eval System v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable quality-eval system for Knosi's Ask AI — first the RAG-retrieval baseline (M1), then an end-to-end agent harness (M2) that runs the same `streamText` call as production with full tool support.

**Architecture:** M1 reuses the existing `scripts/eval-rag.mjs` and only requires data work (annotation set + baseline run). M2 makes one surgical refactor — extracting the `streamText({...})` call inside `streamChatAiSdk` into a shared helper — so production and the harness share a single source of truth. The harness then consumes `result.textStream` + `result.toolCalls` + `result.toolResults` directly, avoiding the brittle UI Message Stream protocol parser the naive approach would require.

**Tech Stack:** Node 22+ (`--experimental-strip-types`), Vercel AI SDK v6 (`ai` + `@ai-sdk/openai`), libsql/Turso, `vitest` (unit), Playwright (e2e). The `agentic-rag.ts` module being measured is TypeScript and is imported directly by the eval `.mjs` scripts via Node's strip-types flag.

**Spec reference:** `docs/superpowers/specs/2026-05-03-agent-eval-system-v1-design.md`

---

## File Structure

### M1 (RAG retrieval baseline) — data only, no `src/` changes

| Path | Purpose | New / Modified |
|---|---|---|
| `eval/ground-truth.json` | 15–20 annotated queries with `relevant_chunk_ids` | Modified (currently 3 unfilled) |
| `eval/results/baseline.json` | First baseline metrics for RAG layer | New |
| `docs/changelog/2026-05-03-rag-eval-baseline.md` | Phase log entry | New |

### M2 (End-to-end agent harness) — small refactor + new harness

| Path | Purpose | New / Modified |
|---|---|---|
| `src/server/ai/provider/ai-sdk.ts` | Extract reusable `runChatStream(...)` helper inside the file (not exported initially); used by both `streamChatAiSdk` and the harness | Modified |
| `src/server/ai/provider/ai-sdk.test.ts` | Add a unit test asserting the new helper has identical behavior to the previous inline call | Modified |
| `eval/agent-cases.json` | 15–20 annotated end-to-end cases | New |
| `scripts/eval-agent.mjs` | End-to-end harness | New |
| `eval/results/agent/baseline.json` | First baseline metrics for E2E layer | New |
| `docs/changelog/2026-05-03-agent-eval-baseline.md` | Phase log entry | New |

**Key boundary:** the new helper inside `ai-sdk.ts` is a private function — only the harness reaches into the file and re-imports it. We do NOT export a polished public API for eval; this is intentional YAGNI. If a second consumer ever appears, promote it then.

---

# Phase M1 — RAG retrieval baseline

## Task 1: Verify Node 22 is available and the eval script can boot

**Files:**
- Read: `scripts/eval-rag.mjs:1-50` (header comments, args)
- Read: `eval/ground-truth.json`

- [ ] **Step 1: Confirm Node 22+ is available**

Run:
```bash
node --version
```

Expected: `v22.x.x` or higher. If not, run `nvm use 22` (the repo has `.nvmrc`; check it). If `nvm` is not installed, the engineer must install Node 22 before continuing.

- [ ] **Step 2: Find your user id from the local SQLite DB**

Run:
```bash
sqlite3 data/second-brain.db 'SELECT id, email FROM users LIMIT 5;'
```

Expected: a row with the engineer's user id (a UUID-like string) and email. Copy the `id` value into a shell variable for the rest of the phase:

```bash
export EVAL_USER_ID="<paste user id here>"
```

If the DB file does not exist, run `pnpm db:push` first to create it, then sign up for an account through the dev server (`pnpm dev`) and re-run the SELECT.

- [ ] **Step 3: Run the harness in seed mode (smoke test)**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --seed-template
```

Expected: the script prints each query (q-001, q-002, q-003) followed by up to 10 candidate `chunkId`s and snippets. No exception. If the import of `src/server/ai/agentic-rag.ts` throws, fix the environment (Node version, env vars) before continuing — do NOT modify the script.

If the run prints "no chunks" for every query, the user has no indexed notes yet. Pause here and create some notes through the UI, wait for the indexer, and re-run. The eval cannot proceed without indexed content.

- [ ] **Step 4: Commit baseline reproduction notes (no file changes yet)**

Nothing to commit at this step. Move to Task 2.

---

## Task 2: Expand the ground-truth annotation set to 15–20 queries

**Files:**
- Modify: `eval/ground-truth.json`

This task is data-entry work, not code. Each query you add costs you ~3–5 minutes of label time. Do not skip — the entire RAG eval is worthless without honest annotations.

- [ ] **Step 1: Decide on a query distribution**

The spec recommends:

- ~6 code / implementation lookups ("how did I implement X")
- ~4 cross-note synthesis ("what do I know about Y")
- ~3 recent-fact recall ("what did I write last week about Z")
- ~3 metadata / tag / folder queries
- ~2 negative cases (queries that should retrieve nothing useful)

Total: 18 queries. Adjust slightly based on what your notes actually contain — if you don't have many recent notes, drop "recent-fact" to 1–2.

- [ ] **Step 2: Write the queries (no labels yet)**

Edit `eval/ground-truth.json` to look like:

```json
{
  "_doc": "RAG eval annotation set. Each entry: id / query / relevant_chunk_ids / notes. Run scripts/eval-rag.mjs --seed-template to print BM25+ANN candidates per query for hand-labeling relevant_chunk_ids.",
  "_usage": "node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs [--ef N] [--top-k N] [--out path] [--seed-template]",
  "queries": [
    {
      "id": "q-001",
      "query": "Tiptap 编辑器粘贴 Markdown 表格的实现",
      "relevant_chunk_ids": [],
      "notes": ""
    },
    {
      "id": "q-002",
      "query": "Hetzner k3s 部署流程",
      "relevant_chunk_ids": [],
      "notes": ""
    }
    // ... etc, IDs q-001 through q-018
  ]
}
```

Use whatever language you actually search Ask AI in — mixing English and Chinese is fine, your tokenizer handles both.

- [ ] **Step 3: Run seed mode to print candidates**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --seed-template --user "$EVAL_USER_ID" > /tmp/eval-seed.txt
cat /tmp/eval-seed.txt
```

Expected: one block per query with up to 10 lines of `<chunkId>  <sourceTitle>  | <preview>`.

- [ ] **Step 4: Hand-label `relevant_chunk_ids` for every query**

For each query, read the candidates and pick **1–5 chunkIds that are genuinely relevant**. Be honest — if no candidate is relevant, leave the array empty (the harness will skip that query and warn you, which is the correct behavior for a negative case).

For negative cases (queries that should retrieve nothing useful), set `relevant_chunk_ids` to `[]` and add `"notes": "negative case — should retrieve nothing relevant"` so future-you knows it's intentional.

Edit `eval/ground-truth.json` directly. Save.

- [ ] **Step 5: Sanity-check the file is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('eval/ground-truth.json','utf8')); console.log('ok')"
```

Expected: `ok`. If it errors, fix the JSON.

- [ ] **Step 6: Commit**

```bash
git add eval/ground-truth.json
git commit -m "eval(rag): expand ground-truth to 18 annotated queries"
```

---

## Task 3: Run the first RAG baseline and commit results

**Files:**
- Create: `eval/results/baseline.json`
- Create: `docs/changelog/2026-05-03-rag-eval-baseline.md`

- [ ] **Step 1: Run the baseline**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs \
  --user "$EVAL_USER_ID" \
  --top-k 16 \
  --out eval/results/baseline.json
```

Expected: a printed table with per-query Recall@5 / Recall@10 / MRR / Latency, plus an aggregate block:

```
Aggregate:
  Recall@5     : 0.xxx
  Recall@10    : 0.xxx
  MRR          : 0.xxx
  p50 latency  : XXXms
  p95 latency  : XXXms
```

And a final line: `保存到 eval/results/baseline.json`. If the harness prints `[skip]` for any query, that query had no labels — go back to Task 2 step 4 and label it (or mark it as a negative case explicitly).

- [ ] **Step 2: Inspect the saved JSON**

Run:
```bash
cat eval/results/baseline.json | head -50
```

Expected: a JSON object with `aggregate` and `perQuery` keys. The `aggregate` object should have all five metrics. If the file is missing or empty, the script crashed silently — re-run Step 1 and watch the console.

- [ ] **Step 3: Write the changelog entry**

Create `docs/changelog/2026-05-03-rag-eval-baseline.md` with this content (replace the metrics with your actual numbers):

````markdown
# 2026-05-03 — RAG eval baseline

## Goal

Establish the first repeatable RAG-retrieval quality baseline for Knosi Ask AI, per spec `docs/superpowers/specs/2026-05-03-agent-eval-system-v1-design.md` (M1).

## Key changes

- Expanded `eval/ground-truth.json` from 3 unfilled queries to 18 hand-annotated queries spanning code lookup, cross-note synthesis, recent-fact recall, metadata queries, and negative cases.
- Ran `scripts/eval-rag.mjs` against the local index for user `<EVAL_USER_ID>` and committed the resulting numbers to `eval/results/baseline.json`.

## Files touched

- `eval/ground-truth.json` (expanded)
- `eval/results/baseline.json` (new)
- `docs/changelog/2026-05-03-rag-eval-baseline.md` (new)

## Verification

```
$ node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --user $EVAL_USER_ID --top-k 16 --out eval/results/baseline.json

Aggregate:
  Recall@5     : 0.xxx     # ← paste your number
  Recall@10    : 0.xxx
  MRR          : 0.xxx
  p50 latency  : XXXms
  p95 latency  : XXXms
```

## Environment

- Node: `<output of node --version>`
- Index size: `<chunks count from agentic-rag log, optional>`
- Reranker: `<enabled / disabled — check RERANKER_ENABLED env>`
- Embedding provider: `<from ai_role_assignments table or env>`

## Known caveats

- Annotation set is 18 queries; small-N noise means single-query changes will visibly move the aggregate. This is acceptable for the author's manual workflow.
- `chunk_id`s are not stable under re-chunking — if the index is rebuilt with different `CHUNK_*` parameters, the labels go stale and need a fresh `--seed-template` pass.

## Remaining risks / follow-ups

- M2 (end-to-end agent harness) is the next milestone in this spec.
- M3–M5 are deferred per the spec; revisit after ~2 weeks of self-use.
````

- [ ] **Step 4: Run lint and build to confirm no breakage**

Run:
```bash
pnpm lint
pnpm build
```

Expected: both pass. (No `src/` changes happened in M1, so this is a sanity check that data files didn't break anything.)

- [ ] **Step 5: Commit**

```bash
git add eval/results/baseline.json docs/changelog/2026-05-03-rag-eval-baseline.md
git commit -m "eval(rag): commit first RAG retrieval baseline (M1 done)"
```

**M1 complete.** Pause here, read the numbers, and decide whether to proceed to M2 immediately or live with M1 for a few days first. Either is fine — M2 is fully independent.

---

# Phase M2 — End-to-end agent harness

## Task 4: Refactor `streamChatAiSdk` to expose a reusable `runChatStream` helper

**Files:**
- Modify: `src/server/ai/provider/ai-sdk.ts:53-104`
- Modify: `src/server/ai/provider/ai-sdk.test.ts`

This is the only `src/` change in M2. It is intentionally minimal — extract the inline `streamText({...})` call into a private named function in the same file, then have both `streamChatAiSdk` and the new harness call it. Production behavior must be byte-identical.

- [ ] **Step 1: Read the current `streamChatAiSdk` body**

Open `src/server/ai/provider/ai-sdk.ts` and read lines 53–104. The body is:

```ts
export async function streamChatAiSdk(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): Promise<StreamChatAiSdkResult> {
  const { provider, messages, signal, system, tools, maxSteps } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  const result = streamText({
    abortSignal: signal,
    model: sdk.chat(provider.modelId),
    messages,
    system,
    ...(hasTools
      ? { tools, stopWhen: stepCountIs(maxSteps ?? 1) }
      : {}),
    experimental_telemetry: { /* ... */ },
  });

  return {
    response: result.toUIMessageStreamResponse({ /* ... */ }),
    modelId: provider.modelId,
  };
}
```

- [ ] **Step 2: Write the refactor — add `runChatStream` and have `streamChatAiSdk` delegate to it**

Replace lines 53–104 of `src/server/ai/provider/ai-sdk.ts` with:

```ts
/**
 * Internal helper: run the underlying `streamText(...)` call. Returns the
 * raw streamText result so callers can either:
 *   - wrap it as a UI Message Stream Response (production /api/chat path), or
 *   - consume `textStream` / `toolCalls` / `toolResults` directly (eval harness).
 *
 * Keeping a single source of truth here is what lets the eval harness exercise
 * the exact same model invocation production uses without duplicating config.
 */
export function runChatStream(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): ReturnType<typeof streamText> {
  const { provider, messages, signal, system, tools, maxSteps } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  return streamText({
    abortSignal: signal,
    model: sdk.chat(provider.modelId),
    messages,
    system,
    ...(hasTools
      ? { tools, stopWhen: stepCountIs(maxSteps ?? 1) }
      : {}),
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: hasTools ? "ask-ai-agent" : "chat",
      metadata: {
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        ...(hasTools ? { hasTools: true, maxSteps: maxSteps ?? 1 } : {}),
      },
    },
  });
}

export async function streamChatAiSdk(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): Promise<StreamChatAiSdkResult> {
  const result = runChatStream(options);
  return {
    response: result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[ai-sdk stream error]", error);
        if (error instanceof Error) return error.message;
        return typeof error === "string" ? error : JSON.stringify(error);
      },
    }),
    modelId: options.provider.modelId,
  };
}
```

Note: `runChatStream` is exported because the harness imports it; this is the only new export.

- [ ] **Step 3: Add a unit test for the new helper**

In `src/server/ai/provider/ai-sdk.test.ts`, add this test inside the existing `describe("streamChatAiSdk", ...)` block (or in a new `describe("runChatStream", ...)` block at the same level):

```ts
import { runChatStream, streamChatAiSdk } from "./ai-sdk";

describe("runChatStream", () => {
  it("returns the raw streamText result with a textStream property", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        'data: {"type":"text","value":"ok"}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const result = runChatStream({
      provider: makeOpenAi("gpt-4o-mini"),
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    // The streamText() result must expose textStream — that's the contract
    // the eval harness depends on.
    expect(result).toBeDefined();
    expect(typeof result.textStream).toBe("object");

    // Drain the stream so the underlying request actually fires.
    for await (const _chunk of result.textStream) {
      // drain
    }

    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the unit tests**

Run:
```bash
pnpm vitest run src/server/ai/provider/ai-sdk.test.ts
```

Expected: all tests pass, including the existing `streamChatAiSdk` tests (proving production behavior is unchanged) and the new `runChatStream` test.

If `streamChatAiSdk` tests fail, the refactor regressed something. Revert and retry — do NOT proceed to step 5 with broken tests.

- [ ] **Step 5: Run the full self-verification suite**

Run, in order:
```bash
pnpm build
pnpm lint
pnpm test:e2e -- --grep "ask-ai|chat" --max-failures 1
```

Expected: build passes, lint passes, the chat e2e flow still works. If `pnpm test:e2e` is too heavy locally, run it later in the M2 commit step — but you MUST run it before M2 is "done".

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/provider/ai-sdk.ts src/server/ai/provider/ai-sdk.test.ts
git commit -m "refactor(ai): extract runChatStream helper for eval harness reuse"
```

---

## Task 5: Define the agent-cases annotation schema and write 15–20 cases

**Files:**
- Create: `eval/agent-cases.json`

- [ ] **Step 1: Write the schema doc and the first case**

Create `eval/agent-cases.json` with:

```json
{
  "_doc": "End-to-end agent eval cases. Each case runs through the real Ask AI pipeline (buildChatContext + runChatStream + buildAskAiTools) via scripts/eval-agent.mjs.",
  "_schema": {
    "id": "stable case id, e.g. ask-001",
    "query": "what the user types into Ask AI",
    "category": "free-form tag, used for future grouping (M4)",
    "expected_tool_touched_note_ids": "the agent must call searchKnowledge or readNote on at least these note ids. Subset relationship: actual ⊇ expected.",
    "must_mention": "case-insensitive substrings that MUST appear in the final answer text",
    "must_not_mention": "case-insensitive substrings that MUST NOT appear (catches 'I don't know', fabricated APIs, etc.)",
    "rubric": "human-readable note explaining why this case exists; not consumed by harness"
  },
  "cases": [
    {
      "id": "ask-001",
      "query": "How did I implement Markdown table paste in the Tiptap editor?",
      "category": "code-recall",
      "expected_tool_touched_note_ids": ["<note-id-of-relevant-note>"],
      "must_mention": ["MarkdownTablePaste", "handlePaste"],
      "must_not_mention": ["I don't know", "I cannot find", "Notion API"],
      "rubric": "Answer must reference the actual implementation; no fabricated APIs."
    }
  ]
}
```

- [ ] **Step 2: Find note ids to use in `expected_tool_touched_note_ids`**

For each case, you need one or more `noteId` values. Run:

```bash
sqlite3 data/second-brain.db "SELECT id, substr(title,1,60) FROM notes WHERE userId='$EVAL_USER_ID' ORDER BY updatedAt DESC LIMIT 30;"
```

Pick the note ids that the agent SHOULD reach via `searchKnowledge` / `readNote` to answer the query well. If a query has no obvious target note, leave `expected_tool_touched_note_ids` as `[]` (the citation score for that case will then always be 1; you're relying on `must_mention` to catch quality).

- [ ] **Step 3: Author the rest of the cases (target: 15–20 total)**

Mirror the distribution from Task 2's RAG queries — overlap is fine and useful. The end-to-end answer for the same query may pass even when retrieval Recall@10 is mediocre, which is itself a signal worth measuring.

Suggested categories to spread across:
- `code-recall` (~5)
- `cross-note-synthesis` (~4)
- `recent-fact` (~3)
- `metadata-query` (~2)
- `negative` (~2): query that should result in `"I don't have information about this"`-style answer; `must_mention` should include something like `"don't have"` or `"not found in your notes"`, and `must_not_mention` should NOT include the negative phrases.

- [ ] **Step 4: Validate JSON**

Run:
```bash
node -e "const c=JSON.parse(require('fs').readFileSync('eval/agent-cases.json','utf8')); console.log('cases:', c.cases.length); for (const x of c.cases) { for (const k of ['id','query','category','expected_tool_touched_note_ids','must_mention','must_not_mention','rubric']) if (x[k]===undefined) throw new Error(x.id+' missing '+k); } console.log('schema ok'); "
```

Expected: prints `cases: 18` (or whatever count) and `schema ok`. Fix any missing fields.

- [ ] **Step 5: Commit**

```bash
git add eval/agent-cases.json
git commit -m "eval(agent): add 18 end-to-end annotated agent cases"
```

---

## Task 6: Implement the agent harness `scripts/eval-agent.mjs`

**Files:**
- Create: `scripts/eval-agent.mjs`

This is the largest single piece of work in M2. Build it in two passes: first get a single case to run end-to-end, then add the scoring + aggregation.

- [ ] **Step 1: Scaffold the script with arg parsing and case loading**

Create `scripts/eval-agent.mjs` with:

```js
#!/usr/bin/env node
// End-to-end agent eval harness — runs annotated cases through the real
// Ask AI pipeline (buildChatContext + runChatStream + buildAskAiTools)
// and scores each case on three dimensions: tool-touched note id coverage,
// must_mention presence, must_not_mention absence.
//
// Usage:
//   node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs --user <id>
//   node ... scripts/eval-agent.mjs --user <id> --out eval/results/agent/run-A.json
//   node ... scripts/eval-agent.mjs --user <id> --only ask-001,ask-005

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const USER_ID = getArg("--user", process.env.EVAL_USER_ID);
const OUT_PATH = getArg("--out", null);
const ONLY = getArg("--only", null); // comma-separated case ids

if (!USER_ID) {
  console.error(
    "Set EVAL_USER_ID env var or pass --user <id>. " +
      "Run: sqlite3 data/second-brain.db 'SELECT id FROM users LIMIT 1;'"
  );
  process.exit(1);
}

const casesPath = resolve(repoRoot, "eval/agent-cases.json");
const casesFile = JSON.parse(await readFile(casesPath, "utf8"));
let cases = casesFile.cases ?? [];
if (ONLY) {
  const allow = new Set(ONLY.split(",").map((s) => s.trim()));
  cases = cases.filter((c) => allow.has(c.id));
}
if (cases.length === 0) {
  console.error("No cases to run. Check eval/agent-cases.json or --only filter.");
  process.exit(1);
}

console.log(`Loaded ${cases.length} case(s) from ${casesPath}`);
```

- [ ] **Step 2: Run the scaffold to verify it loads**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs --user "$EVAL_USER_ID"
```

Expected: prints `Loaded 18 case(s) from .../eval/agent-cases.json` and exits cleanly. No further work yet.

- [ ] **Step 3: Add the production-pipeline reuse — single-case execution**

Append to `scripts/eval-agent.mjs`:

```js
// Production pipeline imports (TS files — Node 22 strip-types makes this work).
const { buildChatContext } = await import(
  resolve(repoRoot, "src/server/ai/chat-prepare.ts")
);
const { runChatStream } = await import(
  resolve(repoRoot, "src/server/ai/provider/ai-sdk.ts")
);
const { resolveAiCall } = await import(
  resolve(repoRoot, "src/server/ai/provider/resolve.ts")
);
const { buildAskAiTools, getOrCreateUrlBudget } = await import(
  resolve(repoRoot, "src/server/ai/tools/index.ts")
);

const MAX_STEPS = 5; // matches production maxStepsForKind for openai-compatible.

async function runOneCase(c) {
  const t0 = Date.now();

  // 1. Build the chat context exactly like /api/chat does.
  const { system, messages } = await buildChatContext(
    {
      messages: [{ role: "user", content: c.query }],
      sourceScope: "all",
    },
    USER_ID,
  );

  // 2. Resolve the chat provider for this user.
  const provider = await resolveAiCall("chat", USER_ID);
  if (provider.kind === "claude-code-daemon" || provider.kind === "transformers") {
    throw new Error(
      `Eval harness does not support provider kind=${provider.kind}. ` +
        `Switch the user's chat role to an openai-compatible or local provider.`,
    );
  }

  // 3. Build tools — same as the production /api/chat handler.
  const conversationId = `eval-${c.id}-${Date.now()}`;
  const tools = buildAskAiTools({
    userId: USER_ID,
    conversationId,
    urlBudget: getOrCreateUrlBudget(conversationId),
  });

  // 4. Run streamText via the shared helper.
  const toolPreamble =
    `\n\n---\n\nYou have access to tools to extend your reach: ` +
    `searchKnowledge, readNote, fetchUrl. Stop calling tools as soon ` +
    `as you can answer. Do not exceed ${MAX_STEPS} steps.`;
  const result = runChatStream({
    provider,
    system: system + toolPreamble,
    messages,
    tools,
    maxSteps: MAX_STEPS,
  });

  // 5. Drain textStream to collect the final answer text.
  let answer = "";
  for await (const delta of result.textStream) {
    answer += delta;
  }

  // 6. Pull tool-touched note ids from toolResults.
  const toolResults = await result.toolResults;
  const touchedNoteIds = new Set();
  for (const tr of toolResults ?? []) {
    if (tr.toolName === "searchKnowledge") {
      for (const item of tr.output?.items ?? []) {
        if (item.id) touchedNoteIds.add(item.id);
      }
    }
    if (tr.toolName === "readNote") {
      const noteId = tr.input?.noteId;
      if (noteId) touchedNoteIds.add(noteId);
    }
  }

  return {
    answer,
    touchedNoteIds: [...touchedNoteIds],
    latencyMs: Date.now() - t0,
  };
}
```

- [ ] **Step 4: Add the scoring logic**

Append:

```js
function scoreCase(c, run) {
  // 1. Citation / tool-touched note id coverage.
  const expected = new Set(c.expected_tool_touched_note_ids ?? []);
  const actual = new Set(run.touchedNoteIds);
  const citationScore =
    expected.size === 0
      ? 1
      : [...expected].filter((id) => actual.has(id)).length / expected.size;

  // 2. must_mention presence (case-insensitive substring).
  const ans = run.answer.toLowerCase();
  const mentions = c.must_mention ?? [];
  const mentionHits = mentions.filter((s) => ans.includes(s.toLowerCase()));
  const mentionScore =
    mentions.length === 0 ? 1 : mentionHits.length / mentions.length;

  // 3. must_not_mention absence (binary; any leak fails).
  const negatives = c.must_not_mention ?? [];
  const leaks = negatives.filter((s) => ans.includes(s.toLowerCase()));
  const negativeScore = leaks.length === 0 ? 1 : 0;

  const pass = citationScore === 1 && mentionScore === 1 && negativeScore === 1;

  return {
    citationScore,
    mentionScore,
    negativeScore,
    pass,
    mentionHits,
    leaks,
  };
}
```

- [ ] **Step 5: Add the run loop and aggregation**

Append:

```js
const perCase = [];
for (const c of cases) {
  process.stdout.write(`[${c.id}] ${c.query.slice(0, 40)}... `);
  let run;
  let scored;
  let runtimeError = null;
  try {
    run = await runOneCase(c);
    scored = scoreCase(c, run);
  } catch (err) {
    runtimeError = err.message ?? String(err);
    run = { answer: "", touchedNoteIds: [], latencyMs: 0 };
    scored = {
      citationScore: 0,
      mentionScore: 0,
      negativeScore: 0,
      pass: false,
      mentionHits: [],
      leaks: [],
    };
  }
  perCase.push({
    id: c.id,
    category: c.category,
    query: c.query,
    ...scored,
    answer: run.answer,
    touchedNoteIds: run.touchedNoteIds,
    latencyMs: run.latencyMs,
    runtimeError,
  });
  console.log(
    `${scored.pass ? "PASS" : "FAIL"} ` +
      `(c=${scored.citationScore.toFixed(2)} m=${scored.mentionScore.toFixed(2)} n=${scored.negativeScore.toFixed(2)} ` +
      `${run.latencyMs}ms${runtimeError ? " ERR:" + runtimeError : ""})`,
  );
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const aggregate = {
  n: perCase.length,
  passRate: perCase.filter((r) => r.pass).length / perCase.length,
  meanCitationScore: mean(perCase.map((r) => r.citationScore)),
  meanMentionScore: mean(perCase.map((r) => r.mentionScore)),
  meanNegativeScore: mean(perCase.map((r) => r.negativeScore)),
  p50LatencyMs: [...perCase.map((r) => r.latencyMs)].sort((a, b) => a - b)[
    Math.floor(perCase.length / 2)
  ],
  runtimeErrors: perCase.filter((r) => r.runtimeError).length,
};

console.log("\nAggregate:");
console.log(`  Pass rate              : ${(aggregate.passRate * 100).toFixed(1)}%`);
console.log(`  Mean citation score    : ${aggregate.meanCitationScore.toFixed(3)}`);
console.log(`  Mean mention score     : ${aggregate.meanMentionScore.toFixed(3)}`);
console.log(`  Mean negative score    : ${aggregate.meanNegativeScore.toFixed(3)}`);
console.log(`  p50 latency            : ${aggregate.p50LatencyMs}ms`);
console.log(`  Runtime errors         : ${aggregate.runtimeErrors}/${aggregate.n}`);

const outPath =
  OUT_PATH ??
  resolve(
    repoRoot,
    `eval/results/agent/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ aggregate, perCase }, null, 2));
console.log(`\nSaved to ${outPath}`);
```

- [ ] **Step 6: Smoke-test on a single case**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs \
  --user "$EVAL_USER_ID" --only ask-001
```

Expected: a single line `[ask-001] How did I implement Markdown table paste... PASS (c=1.00 m=1.00 n=1.00 XXXXms)` (or FAIL if your annotation is wrong; that's fine — fix the annotation, not the harness). The result file should appear under `eval/results/agent/`.

If you get a runtime error like `Eval harness does not support provider kind=claude-code-daemon`, your chat role is currently routed to the daemon — temporarily switch to an openai-compatible provider in your settings UI for the duration of M2, then switch back.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval-agent.mjs
git commit -m "eval(agent): implement end-to-end harness with three-dimension scoring"
```

---

## Task 7: Run the first agent baseline and commit results

**Files:**
- Create: `eval/results/agent/baseline.json`
- Create: `docs/changelog/2026-05-03-agent-eval-baseline.md`

- [ ] **Step 1: Run the full case set**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs \
  --user "$EVAL_USER_ID" \
  --out eval/results/agent/baseline.json
```

Expected: 15–20 lines (one per case), each PASS / FAIL with the three sub-scores and a latency. Then the aggregate block.

This run takes ~5–15 seconds per case × ~18 cases = roughly 2–5 minutes. Don't kill it.

- [ ] **Step 2: Eyeball failed cases and decide what's a real signal**

Open `eval/results/agent/baseline.json` and look at the `perCase` entries where `pass === false`. For each:

- Is the answer text bad (genuine quality fail) — record this, this is what eval is for.
- Is the case annotation wrong (must_mention too strict, expected note id wrong) — fix `eval/agent-cases.json` and re-run only that case.
- Is the harness broken (runtime error, parsing wrong, etc.) — fix the harness.

This is iterative. Plan to spend 30–60 minutes on this step. After this, your annotation set is honest, and the resulting baseline is trustworthy.

- [ ] **Step 3: After the case-set is stable, re-run for the committed baseline**

Run:
```bash
node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs \
  --user "$EVAL_USER_ID" \
  --out eval/results/agent/baseline.json
```

This overwrites the previous baseline file. Verify the file is non-empty and has aggregate + perCase keys.

- [ ] **Step 4: Write the changelog entry**

Create `docs/changelog/2026-05-03-agent-eval-baseline.md`:

````markdown
# 2026-05-03 — End-to-end agent eval baseline

## Goal

Establish the first repeatable end-to-end Ask AI quality baseline, per spec `docs/superpowers/specs/2026-05-03-agent-eval-system-v1-design.md` (M2).

## Key changes

- Refactored `streamChatAiSdk` to delegate to a new `runChatStream` helper, sharing the model invocation between production `/api/chat` and the eval harness.
- Added `eval/agent-cases.json` with 18 hand-annotated cases.
- Added `scripts/eval-agent.mjs` — end-to-end harness scoring on three dimensions (tool-touched note id coverage, must_mention presence, must_not_mention absence).
- Committed first baseline to `eval/results/agent/baseline.json`.

## Files touched

- `src/server/ai/provider/ai-sdk.ts` (refactor)
- `src/server/ai/provider/ai-sdk.test.ts` (new test)
- `eval/agent-cases.json` (new)
- `scripts/eval-agent.mjs` (new)
- `eval/results/agent/baseline.json` (new)
- `docs/changelog/2026-05-03-agent-eval-baseline.md` (new)

## Verification

```
$ pnpm vitest run src/server/ai/provider/ai-sdk.test.ts
  ✓ all streamChatAiSdk tests pass
  ✓ runChatStream returns raw streamText result

$ pnpm build
  ✓ pass

$ pnpm lint
  ✓ pass

$ pnpm test:e2e -- --grep "ask-ai|chat" --max-failures 1
  ✓ chat e2e flow still passes (production behavior unchanged after refactor)

$ node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs --user $EVAL_USER_ID --out eval/results/agent/baseline.json

Aggregate:
  Pass rate              : XX.X%   # ← paste your number
  Mean citation score    : 0.xxx
  Mean mention score     : 0.xxx
  Mean negative score    : 0.xxx
  p50 latency            : XXXXms
  Runtime errors         : 0/18
```

## Environment

- Node: `<output of node --version>`
- Chat provider: `<from ai_role_assignments table>`
- Model: `<modelId from baseline.json>`

## Known caveats / limitations

- 18 cases — small-N noise applies. Movements smaller than ~5% pass-rate are likely noise; movements ≥10% are likely signal.
- Substring `must_mention` is blunt: "do NOT use handlePaste" still passes a `handlePaste` mention assertion. Spot-check failed answers manually.
- Citations are approximated by tool-touched note ids. The agent may "see" a note via a search result and not actually use it; v1 accepts this approximation.
- LLM-as-judge is intentionally NOT in v1; it lands later only if/when the case set grows beyond ~50.

## Remaining risks / follow-ups

- M3 (A/B comparison framework), M4 (categorization), M5 (workflow integration) are deferred.
- Re-evaluate after ~2 weeks of self-use to decide which milestone is the highest-leverage next step.
````

- [ ] **Step 5: Run the full self-verification suite one more time**

Run, in order:
```bash
pnpm build
pnpm lint
pnpm test:e2e -- --grep "ask-ai|chat" --max-failures 1
```

All must pass. If e2e is too heavy, the engineer must run it before the final commit; this milestone modifies a production code path (`ai-sdk.ts`) and cannot ship without e2e confirmation.

- [ ] **Step 6: Commit**

```bash
git add eval/results/agent/baseline.json docs/changelog/2026-05-03-agent-eval-baseline.md
git commit -m "eval(agent): commit first end-to-end baseline (M2 done)"
```

- [ ] **Step 7: Push to main (auto-deploys per project rule)**

Per `CLAUDE.md`: "任务完成且验证通过后，直接 git push 到远程，不需要询问用户确认". This change does NOT alter database schema, so the `git push` → Hetzner deploy is safe.

Run:
```bash
git push origin main
```

Watch the GitHub Actions workflow (`.github/workflows/deploy-hetzner.yml`) finish green. The Hetzner pod will redeploy with the `runChatStream` refactor; verify production Ask AI still works by sending one query through `https://www.knosi.xyz/ask`.

**M2 complete.** Live with the harness for ~2 weeks, then re-enter brainstorming to decide M3 / M4 / M5 ordering.

---

## Self-Review (already performed by author)

**Spec coverage** — every spec section is mapped to at least one task:

| Spec section | Tasks |
|---|---|
| M1: harness runs | Task 1 |
| M1: 15–20 annotated queries | Task 2 |
| M1: baseline.json | Task 3 |
| M1: changelog | Task 3 step 3 |
| M2: case schema | Task 5 step 1 |
| M2: 15–20 cases | Task 5 |
| M2: harness | Task 6 |
| M2: scoring (3 dims, no weighted sum) | Task 6 step 4 |
| M2: pipeline reuse via shared helper | Task 4 |
| M2: tool-touched note ids = citation proxy | Task 6 step 3, scoring step 4 |
| M2: serial execution | Task 6 step 5 (no Promise.all) |
| M2: errors recorded, don't halt run | Task 6 step 5 (try/catch) |
| M2: changelog | Task 7 step 4 |
| Verification: build + lint + e2e | Task 4 step 5, Task 7 step 5 |

**Placeholder scan** — no `TBD` / `TODO` / "fill in" / "implement later" / "similar to Task N" remain. Every code-changing step shows the exact code.

**Type consistency** — `runChatStream` is referenced in Task 4, Task 6 step 3, and the spec verification line; signature matches across all three. `expected_tool_touched_note_ids` is the field name in Task 5 step 1, Task 5 step 2, and Task 6 step 4 — consistent. `touchedNoteIds` is the run-result field, used identically in `runOneCase` (step 3) and `scoreCase` (step 4).
