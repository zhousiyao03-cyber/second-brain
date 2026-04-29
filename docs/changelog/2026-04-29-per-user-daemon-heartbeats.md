# 2026-04-29 · Per-user daemon heartbeats + heartbeat-aware Ask AI errors

## Task / Goal

When the local Knosi CLI daemon was running but authenticated as a different
Google account than the browser session, Ask AI showed a misleading "AI daemon
is not running" error and the `<DaemonBanner>` would either stay hidden (if any
other user's daemon had pinged in the last 90s) or show a generic "set it up"
message. The diagnosis was straightforward — task rows are scoped to the
browser-session userId while `chat_tasks.userId` filters apply to the daemon's
bearer-token userId, so a userId mismatch makes claims invisible — but the
surface area lied about it.

This change makes daemon liveness and ownership a per-user concept end-to-end,
and replaces the catch-all error message with three actionable variants that
reflect what's actually wrong.

## Key changes

### Schema

- `daemon_heartbeats` now has a composite primary key `(user_id, kind)` plus a
  FK on `user_id`. Drops the old single-row-per-kind global table.
- New secondary index `daemon_heartbeats_kind_last_seen_idx` for the ops page's
  cross-user "is anyone online" aggregation.

### Backend

- `POST /api/daemon/ping` — now requires a Bearer access token; writes the
  heartbeat row keyed by the token's `userId`. Pre-change: any unauthenticated
  POST could write the global row.
- `GET /api/daemon/status` — looks up the current NextAuth session user and
  filters by `(userId, kind)`. Returns `online: false, secondsSince: null` when
  no session is present (banner stays hidden on logged-out pages).
- `GET /api/chat/tokens` — when the queued-task deadline (8s) fires, queries
  the user's `daemon` heartbeat and emits one of:
  - **No heartbeat ever**: "No daemon has connected for this account yet. Run
    `knosi login` from this Google account, then `knosi`…"
  - **Stale heartbeat (>90s)**: "Your daemon is offline (last seen Xm ago)…"
  - **Fresh heartbeat**: "Your daemon is online but did not claim this task
    within 8s. This usually means the CLI is authenticated as a different
    account than the one signed in here…"
- `src/server/ops/page-data.ts` — admin Ops dashboard query switched from
  `WHERE kind='chat'` (which was already stale; CLI writes `kind='daemon'`) to
  `MAX(last_seen_at) WHERE kind='daemon'` so it reports cross-user liveness.

### Frontend

- `src/components/ask/ask-page-client.tsx` — the readable-error mapper no
  longer broadly substring-rewrites anything containing "daemon" /
  "enqueue failed" / "AI_PROVIDER" into a single generic message. The server
  now produces specific, actionable text for the daemon-related cases, and the
  mapper passes those through verbatim. Two narrow fallbacks remain for
  low-level transport errors ("Chat enqueue failed: <status>") and a misconfig
  hint mentioning `AI_PROVIDER=claude-code-daemon`.

## Files touched

- `src/server/db/schema/ops.ts`
- `drizzle/0039_acoustic_cloak.sql` (hand-edited — auto-generated SQL tried to
  `INSERT … SELECT user_id` from an old table that has no `user_id` column;
  rewrote to drop+recreate since old rows can't be migrated 1:1)
- `drizzle/meta/0039_snapshot.json`, `drizzle/meta/_journal.json`
- `src/app/api/daemon/ping/route.ts`
- `src/app/api/daemon/status/route.ts`
- `src/app/api/chat/tokens/route.ts`
- `src/server/ops/page-data.ts`
- `src/components/ask/ask-page-client.tsx`
- `scripts/db/apply-2026-04-29-per-user-heartbeats-rollout.mjs` (new)
- `scripts/smoke-heartbeat-error.mjs` (new — local-only validation, see below)

## Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | ✅ 0 errors (14 pre-existing warnings in unrelated files) |
| `pnpm build` (next + tsc) | ✅ compiles, page-data collected after seeding local DB |
| `node scripts/smoke-heartbeat-error.mjs` (4 cases) | ✅ all four error branches return the expected message |
| Production Turso rollout | ✅ table dropped + recreated; PK is `(user_id, kind)`; index present; verification queries pass |
| `pnpm test:e2e` | ❌ blocked by a pre-existing Windows-specific race between Playwright `webServer` (`pnpm db:push && next dev`) and `globalSetup` on `data/second-brain.e2e.db`. Unrelated to this change — the e2e suite runs with `AI_PROVIDER=codex`, which never enters the daemon branch in `/api/chat`. |
| `pnpm test:unit` (vitest) | ❌ blocked by missing `@rolldown/binding-win32-x64-msvc` native binding on this Windows toolchain. Unrelated. |

### Production rollout

```text
$ node scripts/db/apply-2026-04-29-per-user-heartbeats-rollout.mjs
Target: libsql://database-bisque-ladder-vercel-icfg-tnw2bxcy86redrmrihvdkdl7.aws-us-east-1.turso.io
Existing rows under the old schema: 2 (will be dropped; live daemons repopulate within 60s)
Verification:
  OK — table daemon_heartbeats exists
  OK — index daemon_heartbeats_kind_last_seen_idx exists
  OK — column user_id exists
  OK — column kind exists
  OK — column last_seen_at exists
  OK — column version exists
  OK — user_id is NOT NULL
  OK — primary key is (user_id, kind)
✅ Production rollout verified: per-user daemon_heartbeats is ready.
```

## Remaining risks / follow-ups

- **Brief ping-failure window during deploy**: between the schema rollout (run
  before this commit) and the new container coming up, the *old* container's
  `/api/daemon/ping` route writes only `(kind, last_seen_at, version)` and the
  new schema requires `user_id NOT NULL`. So old-pod pings 500 until the new
  pod takes traffic. CLI-side `sendHeartbeat` calls are wrapped in
  `.catch(() => {})`, and heartbeats retry every 60s, so the user-visible
  effect is at most a banner flicker. Acceptable.
- **`hasTable` check still passes**: ops/page-data uses `hasTable` defensively;
  the table exists throughout the rollout, so the dashboard never goes
  "unknown".
- **No automated test in the suite yet**. The smoke script
  (`scripts/smoke-heartbeat-error.mjs`) exercises the message branches but
  isn't wired to CI. Adding a Playwright e2e for the userId-mismatch scenario
  would require multi-account fixture support — out of scope for this fix.
