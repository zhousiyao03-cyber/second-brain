## 2026-03-30

### Task / Goal

Repair the production Focus Tracker V2 rollout after desktop uploads and status sync started returning HTTP 500 from `second-brain-self-alpha.vercel.app`.

### Key Changes

- Diagnosed the failure to a production Turso schema mismatch: deployed V2 API code was live, but the remote database still exposed `activity_sessions.category` and `focus_daily_summaries.category_breakdown`.
- Applied the missing production schema changes directly against Turso:
  - renamed `focus_daily_summaries.category_breakdown` to `tag_breakdown`
  - added `activity_sessions.tags`
  - added `activity_sessions.browser_url`
  - added `activity_sessions.browser_page_title`
  - added `activity_sessions.visible_apps`
  - backfilled existing `activity_sessions.category` values into JSON-array `tags`
  - dropped the legacy `activity_sessions.category` column
- Revalidated both focus desktop endpoints against production using the paired device credentials.

### Files Touched

- `docs/changelog/focus-tracker-v2-prod-schema-repair.md`

### Verification Commands And Results

- `curl -X POST https://second-brain-self-alpha.vercel.app/api/focus/ingest ...`
  - Before repair: `HTTP/2 500`
  - After repair: `HTTP/2 200` with `{"acceptedCount":1,...}`
- `curl https://second-brain-self-alpha.vercel.app/api/focus/status?...`
  - Before repair: `HTTP/2 500`
  - After repair: `HTTP/2 200` with tag-aware daily payload
- Remote schema inspection through `@libsql/client`
  - Confirmed production now has `tags`, `browser_url`, `browser_page_title`, `visible_apps`, and `tag_breakdown`

### Remaining Risks / Follow-up

- The production repair was executed as an operational migration against Turso, not via a successful `drizzle-kit push` run; the repo migration file remains the source of truth, but the remote rollout path should be cleaned up later.
- Desktop hand-testing is still needed to confirm the packaged app now clears the previous upload error in real usage.
