# Focus Tracker V2 Signal Hub Upgrade

date: 2026-03-30

task / goal:
- Implement `docs/superpowers/plans/2026-03-29-focus-tracker-v2.md` across the server focus pipeline and the Tauri collector/runtime.

key changes:
- Replaced the fixed category model with a multi-tag system via `src/server/focus/tags.ts`, and updated focus aggregates, AI summary input, TRPC router output, and `/api/focus/ingest` + `/api/focus/status` to use tags plus browser/context fields.
- Migrated the DB schema from `category` to `tags`, added `browser_url`, `browser_page_title`, `visible_apps`, and renamed `category_breakdown` to `tag_breakdown`.
- Deleted the legacy `src/server/focus/categories.ts` / `categories.js` implementation.
- Upgraded the Tauri session model from `WindowSample` to `EnrichedSample`, extended queued sessions with browser/context fields, lowered sampling thresholds, and removed client-side pre-merge from the outbox.
- Added `accessibility.rs` and `window_list.rs`, switched the collector loop to enriched sampling, updated upload payload coverage, and simplified state handling to server-first display with local unsynced overlays.

files touched:
- `src/server/focus/tags.ts`
- `src/server/focus/tags.js`
- `src/server/focus/tags.test.mjs`
- `src/server/db/schema.ts`
- `src/server/focus/aggregates.ts`
- `src/server/focus/aggregates.test.mjs`
- `src/server/routers/focus.ts`
- `src/server/ai/focus.ts`
- `src/app/api/focus/ingest/route.ts`
- `src/app/api/focus/status/route.ts`
- `src/components/focus/focus-shared.tsx`
- `src/server/focus/categories.ts`
- `src/server/focus/categories.js`
- `drizzle/0008_absent_thanos.sql`
- `drizzle/meta/0008_snapshot.json`
- `drizzle/meta/_journal.json`
- `focus-tracker/src-tauri/Cargo.toml`
- `focus-tracker/src-tauri/Cargo.lock`
- `focus-tracker/src-tauri/src/accessibility.rs`
- `focus-tracker/src-tauri/src/window_list.rs`
- `focus-tracker/src-tauri/src/sessionizer.rs`
- `focus-tracker/src-tauri/src/outbox.rs`
- `focus-tracker/src-tauri/src/status_sync.rs`
- `focus-tracker/src-tauri/src/state.rs`
- `focus-tracker/src-tauri/src/tracker.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/src/uploader.rs`
- `README.md`

verification commands and results:
- `node --test --experimental-strip-types src/server/focus/tags.test.mjs`
  - PASS, 21 tests passed.
- `node --test --experimental-strip-types src/server/focus/aggregates.test.mjs`
  - PASS, 6 tests passed.
- `pnpm db:generate`
  - PASS after resolving interactive column conflicts; generated `drizzle/0008_absent_thanos.sql`.
- `pnpm db:push`
  - PASS after confirming the intentional drop of `activity_sessions.category`; local schema updated.
- `cargo test` in `focus-tracker/src-tauri`
  - PASS, 27 tests passed.
- `cargo build` in `focus-tracker/src-tauri`
  - PASS.
- `pnpm build`
  - PASS.
- `pnpm lint`
  - PASS with 705 warnings and 0 errors; warnings come from generated `focus-tracker/dist` and `focus-tracker/src-tauri/target` assets.

remaining risks or follow-up items:
- `accessibility.rs` uses browser-specific AppleScript URL extraction behind an AX trust check as the practical runtime implementation in this session; it still needs real desktop validation against Chrome/Safari/Arc to confirm reliability.
- `window_list.rs` currently uses a lightweight visible-process enumeration and defaults `screen_index` to `0`; true multi-screen attribution still needs a real Quartz-backed follow-up if the current approximation is insufficient.
- Manual end-to-end validation with `cargo tauri dev` against live browser tabs and multi-screen setups was not completed in this session.
- `db:push` intentionally dropped the legacy `activity_sessions.category` column; old category values are not preserved in the local DB anymore.
