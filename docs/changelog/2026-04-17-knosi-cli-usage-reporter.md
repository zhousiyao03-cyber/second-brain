# 2026-04-17 · Fold usage-reporter into @knosi/cli + scope usage_records per user

## Task / Goal

Fix "usage page not syncing" — the symptom was that no daemon was running locally, so `~/.claude/projects/**/*.jsonl` was never scanned. Root cause: the `usage-reporter` was a separate `tools/` script users had to remember to launch (`pnpm usage:daemon`). Fold it into the already-installed-and-authenticated `@knosi/cli` daemon so one process handles chat tasks + structured tasks + usage sync + daily ping. Also: tighten `POST /api/usage`, which previously had no auth and no per-user scoping.

## Key Changes

### Backend

- `src/server/db/schema.ts` — added `user_id` (NOT NULL, FK → users, cascade delete) to `usage_records`. Replaced `usage_records_date_provider_model_idx` with `usage_records_user_date_provider_model_idx` so per-user upserts don't collide across users.
- `src/app/api/usage/route.ts` — now requires `Authorization: Bearer <access_token>` (validated via `validateBearerAccessToken`). Upserts are scoped to the authenticated `userId`.
- `src/server/routers/usage.ts` — `usage.list` filters by `ctx.userId`.
- `drizzle/0033_ambiguous_the_liberteens.sql` — generated migration (for parity; not used against prod because it relies on a NOT NULL ADD COLUMN that production SQLite can't do).
- `scripts/db/2026-04-17-usage-records-user-id.sql` + `apply-2026-04-17-usage-records-rollout.mjs` — production rollout using the create-new-table + copy + rename pattern so the NOT NULL constraint is safe.

### CLI (`@knosi/cli` 0.1.4 → 0.2.0)

- `packages/cli/src/usage-reporter.mjs` — new; exports `scanUsage()`, `uploadUsage()`, `runUsageSync()`. Bearer token is taken from the CLI's stored config.
- `packages/cli/src/daily-ping-scheduler.mjs` + `.test.mjs` — moved from `tools/usage-reporter/` (unchanged).
- `packages/cli/src/daemon.mjs` — in daemon mode, schedules `syncUsageOnce()` every 5 min and the daily Claude "hello" ping at 05:59 local. In `--once` mode, runs one usage sync too.
- `packages/cli/src/commands/usage-report.mjs` + `index.mjs` — new `knosi usage report` subcommand for one-shot sync.
- `packages/cli/README.md` — documented the two new behaviors.
- `packages/cli/package.json` — bumped to `0.2.0`, updated description, added `usage` keyword.

### Removed

- `tools/usage-reporter/` — deleted. All functionality now lives in `@knosi/cli`.
- `package.json` scripts `usage:report` / `usage:daemon` — removed. Use `knosi usage report` or run the daemon.

## Files Touched

```
drizzle/0033_ambiguous_the_liberteens.sql                    (new)
drizzle/meta/0033_snapshot.json                              (new)
drizzle/meta/_journal.json                                   (modified)
package.json                                                 (modified — removed 2 scripts)
packages/cli/README.md                                       (modified)
packages/cli/package.json                                    (modified — 0.2.0)
packages/cli/src/commands/usage-report.mjs                   (new)
packages/cli/src/daemon.mjs                                  (modified — +usage sync, +daily ping)
packages/cli/src/daily-ping-scheduler.mjs                    (new — moved from tools/)
packages/cli/src/daily-ping-scheduler.test.mjs               (new — moved from tools/)
packages/cli/src/index.mjs                                   (modified — route `usage report`)
packages/cli/src/usage-reporter.mjs                          (new)
scripts/db/2026-04-17-usage-records-user-id.sql              (new)
scripts/db/apply-2026-04-17-usage-records-rollout.mjs        (new)
src/app/api/usage/route.ts                                   (modified — bearer auth)
src/server/db/schema.ts                                      (modified — user_id column + index)
src/server/routers/usage.ts                                  (modified — ctx.userId scoping)
tools/usage-reporter/*                                       (deleted)
```

## Verification Commands and Results

### Production Turso rollout (required by AGENTS.md)

```bash
node scripts/db/apply-2026-04-17-usage-records-rollout.mjs
```

Outcome: first 6 of 7 DDL statements succeeded. The final `COMMIT` step failed with `SQLite error: cannot commit - no transaction is active` — this is the expected behavior of libsql (each `execute()` auto-commits; `BEGIN`/`COMMIT` in multi-statement SQL is a no-op). Post-verification query confirmed the actual database state was correct:

```
schema: CREATE TABLE "usage_records" (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ... )
rows: 113
null user_id rows: 0
indexes: [ sqlite_autoindex_usage_records_1, usage_records_user_date_provider_model_idx ]
```

Followed up by editing the SQL file to drop the redundant `BEGIN TRANSACTION`/`COMMIT` wrappers with a comment explaining why.

### Local dev DB

```bash
pnpm db:push                       # → ✓ Changes applied
sqlite3 data/second-brain.db ".schema usage_records"
```

Confirmed `user_id text NOT NULL` column and new unique index on `(user_id, date, provider, model)`.

### Per-user scoping (end-to-end)

Inserted two rows with different `user_id`, same date/model, and confirmed each user's `SELECT … WHERE user_id = ?` returns only its own data. Cleaned up afterwards.

### Lint

```bash
pnpm lint         # → 0 errors, 9 warnings (all pre-existing on unrelated files)
```

### Unit test

```bash
node --test packages/cli/src/daily-ping-scheduler.test.mjs
# → tests 3, pass 3, fail 0
```

### Smoke test: `knosi usage report` against a prior run

Earlier in the session, `pnpm usage:report` (old path) successfully pushed 107 entries to `https://www.knosi.xyz`, confirming the scan pipeline itself works. After the schema rollout + new code, the old endpoint is no longer reachable by the old unauthenticated script — this is intentional. The new path requires `knosi auth login` and then `knosi usage report`, which will be exercised once the backend change is deployed.

### `pnpm build`

Failed with a pre-existing `Module not found: '@opentelemetry/semantic-conventions'` error in `src/instrumentation.ts`. Confirmed the failure reproduces on `main` with all my changes stashed — this is unrelated to the usage refactor and tracked elsewhere. Not a regression.

## Remaining Risks / Follow-up

1. **Deployment gap**: prod schema now requires `user_id NOT NULL`, but production app code hasn't been deployed yet. Any direct `POST /api/usage` calls that hit prod before the deploy lands will 500. The old unauthenticated reporter is already gone from the repo, and the only live usage-reporter I was running has been removed manually.
2. **Backfill assumption**: the rollout SQL assumes all existing rows belong to `zhousiyao03@gmail.com`. This was correct for this deployment (single active user). If another user ever gets added and later a similar migration is needed, the script must be rewritten.
3. **`pnpm build` is red on main** — unrelated to this change, but flags a broader env issue worth chasing.
