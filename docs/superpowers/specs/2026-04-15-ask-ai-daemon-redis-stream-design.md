# Ask AI Daemon Redis Stream Design

- date: 2026-04-15
- goal: Remove the high-frequency database polling loop from daemon-mode Ask AI while preserving the current browser-facing SSE contract and task durability.

## Current state

- Browser clients in daemon mode already consume `text/event-stream` from `/api/chat/tokens`.
- `/api/chat/tokens` currently polls SQLite every 200ms for new `daemon_chat_messages` rows and task status.
- The local daemon claims queued work via `/api/chat/claim`, writes deltas via `/api/chat/progress`, and finalizes via `/api/chat/complete`.
- The database is doing double duty as both the durable task store and the real-time notification channel.

## Chosen approach

- Keep the browser API as SSE.
- Keep `chat_tasks` and `daemon_chat_messages` as the source of truth for recovery and replay.
- Add a small Redis Pub/Sub event bus for real-time delivery.
- Publish task events from `/api/chat/progress` and `/api/chat/complete`.
- Let `/api/chat/tokens` subscribe to `chat:{taskId}` and stream events immediately instead of polling the database loop.
- Retain a one-time DB catch-up at SSE connection start so reconnects and missed events still work.

## Why not WebSocket

- Browser-to-server transport is already one-way streaming, which SSE handles well with lower operational complexity.
- The real bottleneck is not the browser transport, but the server repeatedly polling SQLite.
- Switching the frontend to WebSocket without changing the backend event source would add connection/state complexity without removing the main inefficiency.

## Data flow

1. `/api/chat` enqueues a durable `chat_tasks` row.
2. Local daemon claims work with `/api/chat/claim`.
3. `/api/chat/progress` writes `daemon_chat_messages` rows and publishes each new delta event to Redis channel `chat:{taskId}`.
4. `/api/chat/complete` updates `chat_tasks` and publishes a terminal `done` or `error` event.
5. `/api/chat/tokens`:
   - authenticates and validates task ownership
   - reads catch-up rows from the database after `afterSeq`
   - subscribes to `chat:{taskId}`
   - forwards published events over SSE until `done`, `error`, client disconnect, or timeout

## Failure handling

- If Redis is unavailable, `/api/chat/tokens` should fall back to the current DB polling behavior so Ask AI still works.
- Publishing failures in `/api/chat/progress` or `/api/chat/complete` must not break durable writes; they should log and continue.
- Reconnects remain safe because the DB still stores ordered deltas by `(taskId, seq)`.

## Verification

- Add targeted tests for event serialization and fallback behavior.
- Verify daemon-mode SSE still works end-to-end after publishing/subscribing changes.
- Run `pnpm lint` and a production `pnpm build`.
