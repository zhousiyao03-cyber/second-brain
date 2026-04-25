# Daemon Persistent Worker

**Date:** 2026-04-25
**Spec:** [docs/superpowers/specs/2026-04-25-daemon-persistent-worker-design.md](../superpowers/specs/2026-04-25-daemon-persistent-worker-design.md)
**Plan:** [docs/superpowers/plans/2026-04-25-daemon-persistent-worker.md](../superpowers/plans/2026-04-25-daemon-persistent-worker.md)

## Goal

Replace the one-shot `claude -p prompt --tools ""` chat path with a persistent
worker pool keyed on `(userId, sourceScope, structuredFlag)`, so:

- Follow-up questions on the same conversation reuse a warm `claude` subprocess
  via `--input-format stream-json` (no per-task cold start, expected drop from
  5–10s to <1s for the second-and-onward token).
- The CLI session id captured from the first `system/init` event is persisted
  so that, after the 10-minute idle timeout kills the subprocess, the next
  message spawns with `claude --resume <id>` and recovers the full
  conversation context without retransmitting history.

## Key changes

- **System prompt split.** `buildSystemPrompt` now has two sibling functions:
  - `buildSystemPromptStable(sourceScope, options)` — identity + scope hint +
    behavior rules. Stable across a conversation, so `--resume` is safe.
  - `buildUserPreamble({ retrieved, sourceScope, pinnedSources, contextNoteText })` —
    `<knowledge_base>` / `<current_note>` / `<pinned_sources>` blocks, returned
    as a string meant to be prepended onto the latest user message.
  - The legacy `buildSystemPrompt` is retained (other code paths still use it).
- **`injectPreambleIntoLatestUser` helper** — pure utility that prepends a
  preamble onto the latest user message in a `ModelMessage[]`, supporting both
  string content and parts-array content. Immutable.
- **`chat-enqueue.ts` and `chat-prepare.ts`** now produce a stable system
  prompt + preamble-augmented messages array. RAG context rides with the
  user message instead of the system prompt.
- **New table `daemon_conversations`** (migration `drizzle/0038_jazzy_alice.sql`)
  stores `(user_id, worker_key, cli_session_id)` for resume.
- **New API endpoint `/api/daemon/conversations`** (GET/POST, bearer-token auth)
  for the daemon to read/write the persisted session id.
- **`@knosi/cli` daemon** —
  - New `chat-worker.mjs`: single Claude subprocess wrapper using
    `--input-format stream-json --output-format stream-json` and
    `--resume <id>` when a session id is known. Holds an internal task queue
    (serialized per worker) and a 10-minute idle timer.
  - New `chat-worker-pool.mjs`: pool keyed on workerKey. Worker exit (idle
    or crash) auto-removes from the pool.
  - `handler-chat.mjs` rewritten to dispatch via the pool. Detects
    "session/conversation not found" errors and retries fresh-spawn with
    flattened-history fallback.
  - `daemon.mjs` instantiates the pool, threads it to `handleChatTask`, shuts
    it down on SIGINT/SIGTERM.
  - `spawn-claude.mjs`: removed `spawnClaudeForChat` (replaced); kept
    `spawnClaudeForStructured` (structured tasks unchanged).
  - `api.mjs`: added `getDaemonConversation` / `setDaemonConversation`.
- **`/api/chat/claim`** route now returns `sourceScope` in the task payload
  (the daemon needs it to compute workerKey).

## Files touched

**Web side:**
- `src/server/ai/chat-system-prompt.ts` (added stable + preamble functions; legacy fn preserved)
- `src/server/ai/chat-system-prompt.test.ts` (new, vitest)
- `src/server/ai/inject-preamble.ts` (new)
- `src/server/ai/inject-preamble.test.ts` (new, vitest)
- `src/server/ai/chat-enqueue.ts` (use stable prompt + preamble)
- `src/server/ai/chat-prepare.ts` (use stable prompt + preamble)
- `src/server/db/schema/daemon-conversations.ts` (new)
- `src/server/db/schema/index.ts` (re-export)
- `drizzle/0038_jazzy_alice.sql` (auto-generated migration)
- `src/app/api/daemon/conversations/route.ts` (new)
- `src/app/api/chat/claim/route.ts` (return sourceScope)

**Daemon CLI side:**
- `packages/cli/src/api.mjs` (added `getDaemonConversation` / `setDaemonConversation`)
- `packages/cli/src/chat-worker.mjs` (new)
- `packages/cli/src/chat-worker.test.mjs` (new, node:test)
- `packages/cli/src/chat-worker-pool.mjs` (new)
- `packages/cli/src/chat-worker-pool.test.mjs` (new, node:test)
- `packages/cli/src/handler-chat.mjs` (rewrite — pool dispatch + resume fallback)
- `packages/cli/src/daemon.mjs` (instantiate pool, thread to handler, shutdown on signal)
- `packages/cli/src/spawn-claude.mjs` (removed `spawnClaudeForChat`)

## Verification

| Step | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (full TS typecheck) | ✅ 0 errors |
| `pnpm build` (Next.js production build) | ✅ Compiled successfully in 18.1s |
| `npx eslint` (raw, bypassing the Unix `mkdir -p` shim that fails on Windows) | ✅ 0 errors, 12 warnings — all pre-existing (img tags, destructure-discarded `content` var) |
| `pnpm db:generate` | ✅ `drizzle/0038_jazzy_alice.sql` generated |
| `pnpm db:push` | ✅ Local schema applied |
| `cd packages/cli && node --test src/chat-worker.test.mjs src/chat-worker-pool.test.mjs src/daemon-notifications.test.mjs src/daily-ping-scheduler.test.mjs` | ✅ 14/14 pass |
| `pnpm test:unit` (vitest) | ⏸ Local skipped — vitest 4.x ESM/CJS conflict on Node 20.17 (env issue, unrelated to this change). CI runs Node 22 and exercises the vitest suites; the new `chat-system-prompt.test.ts` and `inject-preamble.test.ts` will run there. |
| Manual two-message flow | ⏸ TODO — requires daemon restart + manual verification (see "Manual verification" below) |

## Production rollout

Schema change requires a production Turso rollout:

```bash
# 1. Inspect the generated migration
cat drizzle/0038_jazzy_alice.sql

# 2. Apply to production Turso (credentials in .env.turso-prod.local per
#    .claude/rules/production-turso.md)
turso db shell <db-name> < drizzle/0038_jazzy_alice.sql

# 3. Verify the table exists in production
turso db shell <db-name> "SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_conversations';"
```

Then bump and publish the daemon CLI:

```bash
cd packages/cli
npm version patch
npm publish
```

User upgrades local daemon: `npm i -g @knosi/cli@latest` (or whatever
mechanism is in place for distributing the `knosi` binary).

## Manual verification (post-deploy)

Steps to confirm the speedup landed (run on the user's local machine after
upgrading the daemon):

1. Stop the existing daemon (Ctrl-C in its terminal).
2. Run `pnpm daemon`. Confirm "Knosi AI Daemon" banner + claude version line.
3. Open `/ask`, send "你好". Time from send-click to first visible token.
4. Immediately send "刚才我说了什么". Time again.
   - Expected: dramatic drop (target <1s); reply references the first turn.
5. Wait 11 minutes; send a third message.
   - Expected: cold-spawn happens but session resumes (reply still references prior turns); timing intermediate.
6. Confirm `daemon_conversations` row exists for your user with a non-null
   `cli_session_id` (run `pnpm db:studio` and look at the table).

Numbers will be appended to this changelog entry once measured.

## Remaining risks

- `--system-prompt` semantics with `--resume` are not formally documented
  by Anthropic. The spec's **Decision 1** (RAG-to-user-message) made the
  system prompt stable across resumes, so we no longer rely on that
  combination. If the CLI ever rejects it outright, it will surface as a
  resume-miss error and the dispatcher's fallback path will kick in
  (clear session id, retry without `--resume`, replay flattened history).
- Idle timeout (10 min) is hard-coded in `chat-worker.mjs`. If memory
  pressure becomes an issue, expose as `KNOSI_DAEMON_IDLE_TIMEOUT_MS`.
- `chat_tasks` rows written before this change still carry the legacy
  combined system prompt (RAG embedded). Any in-flight queue during deploy
  will complete using the legacy shape; new rows use the new shape.
  Forward-compatible.
- The chat task payload from `/api/chat/claim` now includes `sourceScope`
  but old daemon versions ignored that field; new daemon versions need it.
  Old daemon + new server still works (sourceScope just sits in the
  payload). New daemon + old server would fall back to "all" via
  `task.sourceScope || "all"` in `handler-chat.mjs`. Cross-version
  compatible in both directions.
