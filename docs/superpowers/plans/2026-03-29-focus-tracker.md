# Focus Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-compatible Focus Tracker where a Tauri menubar app captures local activity, uploads sessions to the Second Brain web app, and the web app stores canonical focus data in Turso for analytics and AI summaries.

**Architecture:** The web app is the system of record. The Tauri app samples active windows, merges samples into sessions, and uploads batches to an authenticated ingestion endpoint. The server upserts sessions idempotently, computes daily and weekly analytics using interval-overlap helpers, and renders dashboard and `/focus` views from Turso-backed data.

**Tech Stack:** Tauri v2, Rust, Next.js 16 App Router, tRPC v11, Drizzle ORM, LibSQL/Turso, Vercel AI SDK, Playwright

---

## Scope and sequencing

Implement in three vertical slices:

1. **Web foundation**
   schema, interval-overlap helpers, ingestion endpoint, focus router
2. **Web product surface**
   dashboard card, `/focus`, summary actions, E2E
3. **Desktop collector**
   Tauri tracking loop, local outbox, batch upload, status UI

Part 1 and Part 2 must ship before Part 3 is considered complete. The desktop app depends on the web ingestion path existing first.

---

## File map

### Web app

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/server/db/schema.ts` | Focus tables and idempotency constraints |
| Create | `src/server/focus/types.ts` | Shared focus domain types |
| Create | `src/server/focus/intervals.ts` | Day overlap and aggregation helpers |
| Create | `src/server/focus/aggregates.ts` | Daily and weekly statistics builders |
| Create | `src/server/ai/focus.ts` | Session classification and daily summary generation |
| Create | `src/server/routers/focus.ts` | Read/query/mutation surface for focus |
| Modify | `src/server/routers/_app.ts` | Register focus router |
| Create | `src/app/api/focus/ingest/route.ts` | Authenticated desktop ingestion endpoint |
| Create | `src/lib/focus-utils.ts` | UI-safe date and duration formatting helpers |
| Create | `src/components/focus/*` | Focus page and dashboard components |
| Modify | `src/components/layout/navigation.ts` | Add Focus navigation item |
| Create | `src/app/(app)/focus/page.tsx` | Focus page |
| Modify | `src/app/(app)/page.tsx` | Add dashboard focus card |
| Create | `e2e/focus.spec.ts` | Web E2E coverage |

### Desktop app

The desktop app should live in a sibling workspace such as `/Users/bytedance/focus-tracker` unless you later decide to fold it into this repo.

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/tracker.rs` | Active window polling |
| Create | `src-tauri/src/sessionizer.rs` | Sample merge and idle handling |
| Create | `src-tauri/src/outbox.rs` | Local queued uploads |
| Create | `src-tauri/src/uploader.rs` | HTTPS batch upload client |
| Create | `src-tauri/src/state.rs` | Shared runtime state |
| Modify | `src-tauri/src/main.rs` | Commands, background tasks, tray bootstrap |
| Create | `src/components/StatusPanel.tsx` | Menubar panel |

---

## Part 1: Web foundation

### Task 1: Extend the database schema

**Files:**
- Modify: `src/server/db/schema.ts`

- [ ] **Step 1: Add focus tables with deployable production fields**

Add `activitySessions` and `focusDailySummaries` with:

- `sourceDeviceId`
- `sourceSessionId`
- `ingestionStatus`
- `ingestedAt`
- `updatedAt`
- unique index on `(userId, sourceDeviceId, sourceSessionId)`
- unique index on `(userId, date)` for daily summaries

- [ ] **Step 2: Generate and review the migration**

Run:

```bash
pnpm db:generate
```

Expected:

- a new migration is created under `drizzle/`
- SQL includes the unique idempotency index

- [ ] **Step 3: Apply the schema to the local development database**

Run:

```bash
pnpm db:push
```

Expected:

- local schema updates successfully

### Task 2: Add interval-overlap helpers

**Files:**
- Create: `src/server/focus/types.ts`
- Create: `src/server/focus/intervals.ts`
- Create: `src/server/focus/aggregates.ts`

- [ ] **Step 1: Define focused shared types**

Create domain types for raw persisted sessions, day slices, and aggregate outputs so router/UI code does not re-implement interval math ad hoc.

- [ ] **Step 2: Implement local-day helpers without `toISOString()` day bucketing**

Implement helpers for:

- resolving local day start/end from `YYYY-MM-DD`
- computing overlap seconds between a session and a day window
- splitting a session into a day-local slice for rendering

- [ ] **Step 3: Implement aggregate builders**

Build helpers for:

- `buildDailyStats`
- `buildDailyTimeline`
- `buildWeeklyStats`

The helpers must:

- count only overlapped duration
- handle midnight-crossing sessions
- derive `appSwitches`
- compute `longestStreakSecs` with a `gap <= 120s` rule

- [ ] **Step 4: Add executable tests for overlap behavior**

Choose the test location that matches the existing repo setup and add coverage for:

- same-day session
- midnight-crossing session
- gap breaking a streak
- repeated upload rows not affecting aggregation

### Task 3: Add server AI utilities

**Files:**
- Create: `src/server/ai/focus.ts`

- [ ] **Step 1: Reuse the existing AI provider**

Build:

- `classifyActivitySessions`
- `generateDailySummary`

The functions must operate only on server data and never assume desktop-side model access.

- [ ] **Step 2: Keep categorization bounded**

Use the fixed category set:

- `coding`
- `research`
- `meeting`
- `communication`
- `design`
- `writing`
- `other`

### Task 4: Add authenticated ingestion

**Files:**
- Create: `src/app/api/focus/ingest/route.ts`
- Reuse: `src/lib/auth` and existing auth/session utilities

- [ ] **Step 1: Read the relevant Next.js route handler guidance before coding**

Check the relevant guide under `node_modules/next/dist/docs/` for App Router route handlers.

- [ ] **Step 2: Implement a POST ingestion route**

Route responsibilities:

- require authenticated user
- validate batch body
- normalize timestamps
- compute `durationSecs`
- upsert by `(userId, sourceDeviceId, sourceSessionId)`
- mark rows `pending`

- [ ] **Step 3: Return a retry-friendly response**

Response should include:

- accepted count
- updated count
- rejected items with reasons when validation fails

### Task 5: Add the focus router

**Files:**
- Create: `src/server/routers/focus.ts`
- Modify: `src/server/routers/_app.ts`

- [ ] **Step 1: Expose read endpoints**

Add protected procedures for:

- `dailySessions`
- `dailyStats`
- `weeklyStats`
- `getDailySummary`

These procedures must use the aggregate helpers, not duplicate SQL+date math inline.

- [ ] **Step 2: Expose server-side mutations**

Add:

- `classifySessions`
- `generateSummary`

These mutations must refresh persisted rows or cached summaries on demand.

- [ ] **Step 3: Register the router**

Wire `focus: focusRouter` into `src/server/routers/_app.ts`.

### Task 6: Verify the foundation

- [ ] **Step 1: Run targeted tests for focus interval logic**

Use the exact command for the tests you added in Task 2.

- [ ] **Step 2: Run static validation**

Run:

```bash
pnpm lint
pnpm build
```

Expected:

- lint passes
- build passes

---

## Part 2: Web product surface

### Task 7: Add UI-safe helpers

**Files:**
- Create: `src/lib/focus-utils.ts`

- [ ] **Step 1: Add formatting helpers**

Include helpers for:

- `formatDuration`
- `calcGoalPercent`
- local-date label formatting
- category colors

Do not use `toISOString()` to derive display days.

### Task 8: Build `/focus`

**Files:**
- Create: `src/components/focus/date-picker.tsx`
- Create: `src/components/focus/stats-cards.tsx`
- Create: `src/components/focus/timeline-bar.tsx`
- Create: `src/components/focus/category-breakdown.tsx`
- Create: `src/components/focus/activity-log.tsx`
- Create: `src/components/focus/ai-summary.tsx`
- Create: `src/components/focus/history-section.tsx`
- Create: `src/app/(app)/focus/page.tsx`

- [ ] **Step 1: Read the relevant App Router page guidance before changing page code**

Use the local Next.js docs in `node_modules/next/dist/docs/`.

- [ ] **Step 2: Build the page around real time-of-day positioning**

The timeline component must position slices by clock time within the selected day window, not only by relative duration total.

- [ ] **Step 3: Connect mutations carefully**

`AISummary` should:

- classify pending sessions first when needed
- then generate the daily summary
- invalidate relevant `trpc.focus.*` queries

### Task 9: Add dashboard integration

**Files:**
- Create: `src/components/focus/dashboard-card.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/components/layout/navigation.ts`

- [ ] **Step 1: Add the Focus nav item**

Keep navigation consistent across desktop and mobile nav consumers.

- [ ] **Step 2: Add the dashboard card**

Render today's focus progress from the same focus router data used by `/focus`.

### Task 10: Add web E2E coverage

**Files:**
- Create: `e2e/focus.spec.ts`

- [ ] **Step 1: Seed deterministic focus data for tests**

Use the existing Playwright database setup and test user path.

- [ ] **Step 2: Cover the critical flows**

At minimum test:

- sidebar navigation to `/focus`
- empty state
- seeded day with stats and activity rows
- date navigation
- summary refresh button presence and/or mutation result

- [ ] **Step 3: Run the focused E2E suite**

Run:

```bash
pnpm test:e2e -- e2e/focus.spec.ts
```

Expected:

- the focused suite passes locally

### Task 11: Verify the web product slice

- [ ] **Step 1: Run lint and build again after UI integration**

Run:

```bash
pnpm lint
pnpm build
```

- [ ] **Step 2: Re-run the focused E2E suite**

Run:

```bash
pnpm test:e2e -- e2e/focus.spec.ts
```

---

## Part 3: Desktop collector

### Task 12: Scaffold the Tauri app

- [ ] **Step 1: Create the app in a separate workspace**

Scaffold a dedicated Tauri app outside the main Next.js app directory.

- [ ] **Step 2: Add runtime config**

Define:

- web base URL
- desktop API token or login strategy
- upload interval
- sample interval
- idle timeout

### Task 13: Build collector and outbox

**Files:**
- Create: `src-tauri/src/tracker.rs`
- Create: `src-tauri/src/sessionizer.rs`
- Create: `src-tauri/src/outbox.rs`
- Create: `src-tauri/src/state.rs`

- [ ] **Step 1: Implement active-window sampling**

macOS-only for MVP.

- [ ] **Step 2: Merge samples into sessions**

Rules:

- same app + same title extends current session
- changed app/title closes current session and queues upload
- idle timeout closes current session

- [ ] **Step 3: Persist unsent sessions locally**

The outbox needs:

- stable `deviceId`
- queued unsent session payloads
- retry metadata

### Task 14: Build uploader

**Files:**
- Create: `src-tauri/src/uploader.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Batch POST queued sessions to the web ingestion route**

Uploader behavior:

- retries with backoff
- leaves unsent payloads in the outbox on failure
- removes payloads only after success

- [ ] **Step 2: Surface minimal operational state**

Track:

- tracking on/off
- last upload status
- current app/title
- today's local accumulated time

### Task 15: Build the menubar panel

**Files:**
- Create: `src/components/StatusPanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Render today's local status**

Show:

- total today
- progress to 8h
- current activity
- upload state
- open dashboard action

- [ ] **Step 2: Add a compact timeline**

The desktop timeline may be approximate for MVP, but it should use the same category colors as the web UI when available.

### Task 16: Verify desktop-to-web ingestion

- [ ] **Step 1: Run the Tauri compile checks**

Use:

- frontend build
- `cargo check`

- [ ] **Step 2: Run an ingestion smoke test against the local web app**

Prove that:

- sessions upload successfully
- repeated uploads do not duplicate rows
- `/focus` reflects uploaded sessions

---

## Documentation and completion

### Task 17: Update project docs

**Files:**
- Modify: `README.md` when feature status or setup changes
- Create: `docs/changelog/2026-03-29-focus-tracker.md`

- [ ] **Step 1: Record what changed**

The changelog entry must include:

- date
- task / goal
- key changes
- files touched
- verification commands and actual outcomes
- remaining risks or follow-ups

- [ ] **Step 2: Update README if setup or project status changed**

At minimum document how the desktop collector relates to the deployed web app and Turso.

### Task 18: Final verification gate

- [ ] **Step 1: Re-run the strongest realistic checks for the work completed so far**

For web-only completion this means:

- targeted tests
- `pnpm lint`
- `pnpm build`
- focused Playwright suite

For desktop completion add:

- `cargo check`
- ingest smoke test

- [ ] **Step 2: Do not mark done until evidence exists**

If any check cannot run, record the exact blocker in the changelog and final handoff.

---

## Immediate execution recommendation

Start with Part 1 only:

1. schema
2. interval helpers + tests
3. ingestion route
4. focus router

That gives a stable foundation for everything else and removes the biggest architecture risk first.
