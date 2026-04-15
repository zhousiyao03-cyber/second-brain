# Daemon Claim Notifications Design

- date: 2026-04-15
- goal: Reduce database load from the local Claude daemon by replacing fixed-interval chat claim polling with Redis-backed wake notifications while preserving the existing task table, atomic claim route, and reliability fallbacks.

## Problem

The browser-facing Ask AI stream no longer polls `daemon_chat_messages`, but the local daemon still polls `/api/chat/claim` on a fixed cadence for both `chat` and `structured` task types. In production this keeps generating repeated `chat_tasks` reads and zombie-reclaim updates even when no queued work exists.

## Constraints

- Keep the durable task source of truth in `chat_tasks`.
- Keep `/api/chat/claim` as the only place that atomically transitions a queued task to running.
- Do not introduce WebSockets.
- Continue to work when Redis is unavailable by falling back to periodic claims.
- Minimize CLI dependency changes and avoid adding third-party packages.

## Chosen Approach

Use a Redis-backed daemon wake channel plus an authenticated SSE endpoint:

1. When a chat task is enqueued, publish a lightweight wake event on a per-user Redis channel.
2. The CLI daemon opens one long-lived SSE connection to `/api/daemon/tasks`.
3. On connect, the server emits a snapshot of currently queued task types for that user so reconnects do not miss already-queued work.
4. The daemon only calls `/api/chat/claim` when:
   - it receives a wake event,
   - it receives a snapshot indicating queued work,
   - one of its in-flight workers finishes and there may be more queued tasks,
   - or a coarse fallback timer fires.
5. If Redis subscription setup fails, the daemon still relies on the fallback timer so work remains claimable.

## Scope

- Optimize daemon wakeups for `/api/chat/claim` task types (`chat` and `structured`).
- Reuse existing Redis client infrastructure.
- Add focused unit tests for notification serialization/subscription and CLI SSE parsing.

## Non-Goals

- Re-architect OSS analysis daemon flows.
- Replace the atomic claim API with push-based task assignment.
- Remove the fallback periodic claim path completely.

## Data Flow

1. `enqueueChatTask()` inserts a queued `chat_tasks` row, then publishes `{ taskType: "chat" }`.
2. `/api/daemon/tasks` authenticates the daemon, emits a snapshot, subscribes to `daemon:tasks:<userId>`, and forwards events via SSE.
3. The CLI daemon receives `wake` or `snapshot` events and drains `/api/chat/claim` until either:
   - no more tasks are returned, or
   - local concurrency limits are full.
4. When a worker finishes, the daemon attempts another drain for that same task type to pick up any remaining queue.

## Reliability Model

- Snapshot-on-connect handles missed notifications across reconnects.
- The existing DB-backed task queue remains authoritative.
- A slower fallback claim interval prevents starvation if Redis or SSE is unavailable.
- The daemon keeps the current heartbeat behavior unchanged.

## Verification Strategy

- Unit test Redis notification channel helpers.
- Unit test CLI SSE parsing / wake event extraction.
- Run `pnpm lint` and a production `pnpm build`.
- Deploy to Hetzner and inspect logs to confirm `daemon_chat_messages` polling remains gone and `/api/chat/claim` traffic becomes wake-driven instead of constant idle polling.
