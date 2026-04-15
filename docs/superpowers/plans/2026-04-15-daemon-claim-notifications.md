# Daemon Claim Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-interval daemon chat claim polling with Redis-backed wake notifications plus a slower fallback claim timer.

**Architecture:** Keep `chat_tasks` as the durable queue and `/api/chat/claim` as the atomic claimant. Add a Redis-backed per-user wake channel and an authenticated SSE route that the CLI daemon listens to. The daemon drains claims only on wake, reconnect snapshot, worker completion, or coarse fallback.

**Tech Stack:** Next.js Route Handlers, Drizzle ORM, Redis Pub/Sub, Node.js fetch streams, node:test

---

### Task 1: Add daemon wake notification primitives

**Files:**
- Create: `src/server/ai/daemon-task-notifications.ts`
- Test: `src/server/ai/daemon-task-notifications.test.mjs`

- [ ] Write unit tests for channel naming, event round-tripping, publish behavior, and subscribe/close behavior.
- [ ] Implement the per-user Redis channel helper and typed wake event helpers.
- [ ] Run the new notification tests.

### Task 2: Publish wake events when chat tasks are queued

**Files:**
- Modify: `src/server/ai/chat-enqueue.ts`
- Modify: `src/server/ai/provider.ts`

- [ ] Publish a wake event after durable `chat_tasks` inserts.
- [ ] Cover both normal chat enqueue and daemon-backed structured enqueue paths where feasible.
- [ ] Verify existing builds still typecheck and no route contract changes are required.

### Task 3: Add an authenticated daemon SSE wake route

**Files:**
- Create: `src/app/api/daemon/tasks/route.ts`
- Modify: `src/proxy.ts`

- [ ] Implement SSE framing helpers and initial queued-task snapshot behavior.
- [ ] Authenticate with the same bearer-token path used by `/api/chat/claim`.
- [ ] Subscribe to the Redis user wake channel and emit wake events.
- [ ] Add keepalive behavior and safe cleanup on disconnect.

### Task 4: Teach the CLI daemon to wait for wake events

**Files:**
- Create: `packages/cli/src/daemon-notifications.mjs`
- Create: `packages/cli/src/daemon-notifications.test.mjs`
- Modify: `packages/cli/src/api.mjs`
- Modify: `packages/cli/src/daemon.mjs`

- [ ] Add a tiny SSE parser / iterator for daemon wake events.
- [ ] Add an API helper that connects to `/api/daemon/tasks`.
- [ ] Replace fixed `setInterval` claim loops with wake-driven drains plus a coarse fallback timer.
- [ ] Re-trigger claim draining when workers complete so one wake can consume multiple queued tasks up to concurrency limits.
- [ ] Run CLI notification tests.

### Task 5: Verify, document, and deploy

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog/2026-04-15-daemon-claim-notifications.md`

- [ ] Run targeted tests, `pnpm lint`, and a production build.
- [ ] Deploy to Hetzner.
- [ ] Inspect recent production logs to confirm idle `/api/chat/claim` load drops and wake-driven claims work.
- [ ] Record outcomes and residual risks in the changelog.
