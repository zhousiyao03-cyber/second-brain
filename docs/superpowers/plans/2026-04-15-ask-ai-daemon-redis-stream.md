# Ask AI Daemon Redis Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace daemon-mode Ask AI database polling with Redis Pub/Sub while keeping the existing browser-facing SSE API and durable task history.

**Architecture:** Add a tiny Redis-backed event bus for `chat:{taskId}` channels, publish task updates from daemon progress/complete endpoints, and change `/api/chat/tokens` to do an initial database catch-up followed by live Redis subscription. If Redis is unavailable, retain the current DB polling path as a safe fallback.

**Tech Stack:** Next.js Route Handlers, node-redis v5, SQLite/Drizzle, SSE

---

### Task 1: Add a daemon chat event bus

**Files:**
- Create: `src/server/ai/daemon-chat-events.ts`
- Test: `src/server/ai/daemon-chat-events.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create tests that:
- verify channel naming is stable for a task id
- verify publish payloads round-trip through serialize/parse helpers
- verify invalid payloads are rejected safely

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm tsx --test src/server/ai/daemon-chat-events.test.mjs`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Implement the event bus helpers**

Create a focused helper that exposes:
- `getChatEventChannel(taskId)`
- `publishChatEvent(event)`
- `parseChatEvent(raw)`

Use Redis when available and return graceful fallbacks when it is not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm tsx --test src/server/ai/daemon-chat-events.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/daemon-chat-events.ts src/server/ai/daemon-chat-events.test.mjs
git commit -m "feat: add ask ai daemon event bus"
```

### Task 2: Publish daemon progress and completion events

**Files:**
- Modify: `src/app/api/chat/progress/route.ts`
- Modify: `src/app/api/chat/complete/route.ts`
- Test: `src/server/ai/daemon-chat-events.test.mjs`

- [ ] **Step 1: Extend tests for publish payload shapes**

Add assertions covering:
- `text_delta` events published from progress messages
- `done` and `error` terminal events published from complete

- [ ] **Step 2: Run the tests to verify the new assertions fail**

Run: `pnpm tsx --test src/server/ai/daemon-chat-events.test.mjs`
Expected: FAIL on missing publisher behavior.

- [ ] **Step 3: Implement publishing after durable writes**

Update:
- `/api/chat/progress` to insert DB rows first, then publish delta events
- `/api/chat/complete` to update DB first, then publish terminal events

Publishing failures should log and continue so persistence remains authoritative.

- [ ] **Step 4: Re-run the tests**

Run: `pnpm tsx --test src/server/ai/daemon-chat-events.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/progress/route.ts src/app/api/chat/complete/route.ts src/server/ai/daemon-chat-events.test.mjs
git commit -m "feat: publish ask ai daemon events"
```

### Task 3: Replace `/api/chat/tokens` polling loop with Redis subscription plus fallback

**Files:**
- Modify: `src/app/api/chat/tokens/route.ts`
- Modify: `src/server/redis.ts` (only if a dedicated subscriber client helper is needed)
- Test: `src/app/api/chat/tokens.test.mjs` or `src/server/ai/daemon-chat-events.test.mjs`

- [ ] **Step 1: Write failing tests for stream behavior**

Cover:
- initial DB catch-up still emits missing deltas after `afterSeq`
- live published events are forwarded without waiting for DB polling
- missing Redis falls back to the legacy DB polling path

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm tsx --test src/app/api/chat/tokens.test.mjs`
Expected: FAIL on missing subscription-based behavior.

- [ ] **Step 3: Implement the new SSE flow**

Change `/api/chat/tokens` to:
- authenticate and verify task ownership
- emit DB catch-up rows once
- subscribe to `chat:{taskId}`
- forward delta/done/error events immediately
- close cleanly on terminal events, disconnect, or timeout
- fall back to the existing DB polling loop when Redis is unavailable

- [ ] **Step 4: Re-run the targeted tests**

Run: `pnpm tsx --test src/app/api/chat/tokens.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/tokens/route.ts src/app/api/chat/tokens.test.mjs src/server/redis.ts
git commit -m "feat: stream ask ai daemon events over redis"
```

### Task 4: Final verification and docs

**Files:**
- Modify: `README.md` (only if operational behavior changed enough to document)
- Create: `docs/changelog/2026-04-15-ask-ai-daemon-redis-stream.md`

- [ ] **Step 1: Run targeted verification**

Run:
- `pnpm tsx --test src/server/ai/daemon-chat-events.test.mjs`
- `pnpm tsx --test src/app/api/chat/tokens.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run repository safety checks**

Run:
- `pnpm lint`
- `AUTH_SECRET=test-secret TURSO_DATABASE_URL=file:data/second-brain.db NEXT_DEPLOYMENT_ID=ask-ai-redis-stream pnpm build`

Expected: PASS with only pre-existing warnings from lint.

- [ ] **Step 3: Write changelog entry**

Document:
- what changed
- files touched
- verification commands/results
- fallback behavior and remaining risks

- [ ] **Step 4: Commit**

```bash
git add README.md docs/changelog/2026-04-15-ask-ai-daemon-redis-stream.md
git commit -m "docs: record ask ai redis stream rollout"
```
