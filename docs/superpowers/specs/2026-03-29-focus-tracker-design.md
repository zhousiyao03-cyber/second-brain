# Focus Tracker - Design Spec

## Overview

Focus Tracker is a two-part feature for Second Brain:

1. A lightweight Tauri menubar app running on macOS collects active-window samples, merges them into local sessions, and batches them to the Second Brain web app.
2. The Second Brain web app persists normalized sessions in Turso, runs AI categorization and summaries server-side, and exposes daily and historical analytics in the dashboard and `/focus`.

This replaces the earlier "shared SQLite database" idea. Shared local SQLite is acceptable for local prototypes, but it is not the production architecture for a deployed product backed by Turso.

## Goals

1. Automatically track focus time without manual start/stop.
2. Keep desktop collection lightweight and resilient to temporary network failures.
3. Store canonical focus data in the deployed web app's database so analytics work in production.
4. Generate AI labels and summaries server-side, where credentials, rate limits, and auditing already live.
5. Show useful daily and weekly analytics in the dashboard and on `/focus`.

## Non-Goals (MVP)

- Full offline sync engine across multiple devices.
- Desktop app direct writes to Turso.
- Browser URL capture.
- Cross-device reconciliation and merge conflict resolution.
- Deep correlation with notes/todos/journal content.
- Background blocking or focus enforcement features.

---

## Production Architecture

```text
┌──────────────────────────┐        HTTPS / auth        ┌──────────────────────────┐
│ Tauri Menubar App        │ ───────────────────────▶  │ Second Brain Web App     │
│                          │                           │                          │
│ 1. Sample active window  │                           │ A. Validate ingestion    │
│ 2. Merge local session   │                           │ B. Upsert into Turso     │
│ 3. Queue unsent events   │                           │ C. Run AI classification │
│ 4. Batch upload          │                           │ D. Serve /focus + cards  │
└──────────────────────────┘                           └──────────────────────────┘
                                                               │
                                                               ▼
                                                        ┌────────────┐
                                                        │ Turso DB   │
                                                        └────────────┘
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Canonical database | Turso / LibSQL via existing server | Matches the deployable architecture already used by the app |
| Desktop write path | Call authenticated web ingestion endpoint | Keeps DB credentials off the desktop app and centralizes validation |
| Local durability | Small local queue / outbox in Tauri | Enough to survive offline or transient failures without building full sync |
| Sampling interval | 5 seconds | Good enough for MVP accuracy with low overhead |
| Upload mode | Batched session upserts | Reduces network chatter and supports retry |
| AI execution | Server-side only | Reuses existing provider code and avoids shipping model credentials |

---

## Data Model

### `activity_sessions`

Canonical persisted focus sessions.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | Server-generated UUID |
| user_id | text FK -> users | Owner |
| source_device_id | text | Stable desktop app/device identifier |
| source_session_id | text | Client-generated idempotency key for a merged session |
| app_name | text | Foreground app name |
| window_title | text | Foreground window title |
| started_at | integer timestamp | Session start |
| ended_at | integer timestamp | Session end |
| duration_secs | integer | Denormalized duration |
| category | text nullable | AI-assigned category |
| ai_summary | text nullable | AI-generated session description |
| ingestion_status | text | `pending` / `processed` / `failed` |
| ingested_at | integer timestamp | When server accepted the latest payload |
| created_at | integer timestamp | Record creation |
| updated_at | integer timestamp | Last update |

Constraints:

- Unique index on `(user_id, source_device_id, source_session_id)` for idempotent uploads.
- Server accepts repeated uploads for the same logical session and updates the existing row.

### `focus_daily_summaries`

Cached AI daily summaries.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| user_id | text FK -> users | Owner |
| date | text | Local-calendar day in `YYYY-MM-DD` |
| timezone | text | IANA timezone used for that day's aggregation |
| total_focus_secs | integer | Total overlapped focus time for the day |
| category_breakdown | text JSON | Per-category seconds |
| ai_analysis | text | Cached daily summary |
| source_updated_at | integer timestamp | Max session update time included in summary |
| generated_at | integer timestamp | Last generation time |
| created_at | integer timestamp | |
| updated_at | integer timestamp | |

---

## Desktop App Responsibilities

The Tauri app is a collector and uploader, not the source of truth.

### Local capture flow

1. Every 5 seconds, read the active macOS app name and window title.
2. If the sample matches the current in-memory session, extend it.
3. If it changes, close the current session and append it to a local outbox.
4. If the machine is idle for more than 5 minutes, close the current session and mark tracking paused.
5. Periodically upload unsent sessions in batches to the web app.

### Local storage

The desktop app may keep a tiny local SQLite or JSON-backed outbox containing:

- queued sessions waiting for upload
- upload attempts / last error
- stable `device_id`
- lightweight local today stats for menu rendering

This local store is not queried by the web app in production and is not treated as canonical business data.

### Upload API contract

The desktop app sends batched session payloads like:

```json
{
  "deviceId": "macbook-pro-14-abc123",
  "timezone": "Asia/Singapore",
  "sessions": [
    {
      "sourceSessionId": "2026-03-29T09:00:00.000Z-vscode-auth-ts",
      "appName": "Visual Studio Code",
      "windowTitle": "auth.ts - second-brain",
      "startedAt": "2026-03-29T09:00:00.000Z",
      "endedAt": "2026-03-29T09:45:00.000Z"
    }
  ]
}
```

Server behavior:

- require authenticated user context
- validate payload shape and timestamps
- compute `duration_secs`
- upsert by `(user_id, source_device_id, source_session_id)`
- return accepted ids and retryable failures

---

## Web App Responsibilities

### Ingestion

The web app owns canonical persistence. This is implemented as an authenticated server endpoint or protected tRPC mutation used by the desktop app.

### Aggregation semantics

Daily and weekly analytics must use interval overlap, not "session started on that day".

Rules:

- A session belongs to a day if its interval overlaps that day window.
- If a session crosses midnight, it must be split logically during aggregation so each day only receives its overlapped duration.
- Day boundaries are computed in the viewer's local timezone.
- Stored raw sessions remain intact; splitting happens in query/aggregation code.

### Longest streak

For MVP, "Longest Streak" means the longest continuous overlapped focus duration within a day where:

- idle gaps larger than 2 minutes break the streak
- explicit paused periods break the streak
- switching sessions does not automatically break the streak if there is no qualifying gap

This is a pragmatic interpretation of uninterrupted focus time. "Unrelated apps" inference is deferred.

### AI flow

1. Newly ingested sessions are marked `pending`.
2. On `/focus` load or manual refresh, the server classifies any pending sessions for the selected day or week.
3. Daily summary generation reads normalized sessions and cached aggregates, then stores a summary row.
4. Journal insertion is deferred until the focus page and summary pipeline are stable.

---

## UI Scope

### Dashboard card

- Today's total focus time
- Goal progress
- Mini day timeline using true time-of-day positioning
- Top apps by duration
- Link to `/focus`

### `/focus`

Top section:

- selected day header
- total focus
- goal percentage
- longest streak
- app switches
- true time-of-day timeline
- category breakdown
- activity log
- AI summary

Bottom section:

- weekly trend cards
- stacked daily bars by category
- optional weekly AI insight after core daily flow is stable

---

## Verification Strategy

### Web

- Unit or integration tests for day-overlap aggregation helpers.
- E2E coverage for `/focus` empty state, seeded state, navigation, and summary refresh flow.
- `pnpm lint` and `pnpm build` before completion.

### Desktop

- Command-level verification for the tracking loop and upload retry behavior.
- At least one executable ingest smoke test against a local/dev server.

---

## Delivery Order

1. Web data model and aggregation utilities.
2. Web ingestion endpoint and focus router.
3. `/focus` page and dashboard card.
4. E2E coverage for web flow.
5. Tauri collector and uploader.
6. Desktop status UI and final end-to-end smoke checks.
