# Focus App-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/focus` into an App-first page that leads with cumulative app time, selected-app drilldown, and a demoted global timeline.

**Architecture:** Keep the existing server data shape, but move the page UI to an App-first client-side information model. Add a small helper layer that groups raw sessions by app, computes selected-app detail metrics, and drives the leaderboard, app detail panel, and timeline highlighting from the same source of truth.

**Tech Stack:** Next.js 16 App Router, React 19 client components, tRPC, Node test runner, Playwright

---

### Task 1: Add helper coverage for the App-first information model

**Files:**
- Create: `src/components/focus/focus-app-groups.ts`
- Create: `src/components/focus/focus-app-groups.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppGroups,
  getDefaultSelectedApp,
  getSelectedAppDetails,
} from "./focus-app-groups.ts";

test("buildAppGroups sorts apps by cumulative duration and computes percentages", () => {
  const groups = buildAppGroups(
    [
      { id: "a", appName: "Chrome", durationSecs: 1200, startedAt: new Date("2026-03-31T01:00:00Z"), endedAt: new Date("2026-03-31T01:20:00Z") },
      { id: "b", appName: "Code", durationSecs: 2400, startedAt: new Date("2026-03-31T02:00:00Z"), endedAt: new Date("2026-03-31T02:40:00Z") },
      { id: "c", appName: "Chrome", durationSecs: 600, startedAt: new Date("2026-03-31T03:00:00Z"), endedAt: new Date("2026-03-31T03:10:00Z") },
    ],
    4200
  );

  assert.equal(groups[0].appName, "Code");
  assert.equal(groups[0].durationSecs, 2400);
  assert.equal(groups[0].percentage, 57);
  assert.equal(groups[1].appName, "Chrome");
  assert.equal(groups[1].durationSecs, 1800);
});

test("getSelectedAppDetails returns longest session and first/last seen", () => {
  const details = getSelectedAppDetails("Chrome", [
    { id: "a", appName: "Chrome", durationSecs: 1200, startedAt: new Date("2026-03-31T01:00:00Z"), endedAt: new Date("2026-03-31T01:20:00Z"), windowTitle: "Mail" },
    { id: "b", appName: "Chrome", durationSecs: 600, startedAt: new Date("2026-03-31T04:00:00Z"), endedAt: new Date("2026-03-31T04:10:00Z"), windowTitle: "Docs" },
  ]);

  assert.equal(details?.sessionCount, 2);
  assert.equal(details?.longestSessionSecs, 1200);
  assert.equal(details?.firstSeenAt.toISOString(), "2026-03-31T01:00:00.000Z");
  assert.equal(details?.lastSeenAt.toISOString(), "2026-03-31T04:10:00.000Z");
});

test("getDefaultSelectedApp returns the top app name", () => {
  assert.equal(getDefaultSelectedApp([{ appName: "Code" }, { appName: "Chrome" }]), "Code");
  assert.equal(getDefaultSelectedApp([]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/components/focus/focus-app-groups.test.mjs`

Expected: FAIL because `focus-app-groups.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildAppGroups(sessions, totalSecs) { /* group by appName, sum durationSecs, sort desc */ }
export function getDefaultSelectedApp(groups) { /* first appName or null */ }
export function getSelectedAppDetails(appName, sessions) { /* filter sessions, compute derived fields */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/components/focus/focus-app-groups.test.mjs`

Expected: PASS

### Task 2: Lock the redesigned page behavior with a focused E2E assertion update

**Files:**
- Modify: `e2e/focus-tracker.spec.ts`

- [ ] **Step 1: Write the failing test changes**

Update the existing `/focus` assertions so they check:

- top apps appears before the timeline-driven list in the reading order
- the top app is shown in the selected app detail panel by default
- selecting a different app updates the detail panel

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test e2e/focus-tracker.spec.ts --workers=1`

Expected: FAIL because the current page has no selected-app detail interaction.

- [ ] **Step 3: Keep the failing assertions narrow**

Prefer stable role/test-id based assertions over CSS structure checks.

### Task 3: Implement the App-first `/focus` redesign

**Files:**
- Modify: `src/components/focus/focus-page-client.tsx`
- Modify: `src/components/focus/focus-shared.tsx`
- Modify: `src/components/focus/focus-top-apps.ts`
- Modify: `src/components/focus/focus-display.ts`
- Create: `src/components/focus/focus-app-groups.ts`

- [ ] **Step 1: Add app grouping helper implementation**

Implement:

- cumulative duration grouping by app
- per-app percentage of tracked day
- selected-app detail derivation
- stable default selection behavior

- [ ] **Step 2: Update `/focus` state model**

Add selected app state in `focus-page-client.tsx`:

- derive app groups from `dailySessions`
- auto-select the top app when data loads
- switch selected app on leaderboard click

- [ ] **Step 3: Replace the old first-screen layout**

Restructure the page so the top order becomes:

- compact summary header
- top apps leaderboard
- selected app detail
- day timeline
- daily summary
- filtered out
- desktop access

- [ ] **Step 4: Build the selected app detail panel**

Render:

- app title
- total duration
- session count
- longest session
- first seen / last seen
- mini app-only timeline
- session list

- [ ] **Step 5: Update the global timeline**

Keep raw session placement by true time of day, but visually emphasize sessions that belong to the selected app.

- [ ] **Step 6: Preserve existing non-layout functionality**

Keep:

- date navigation
- refresh
- summary generation
- filtered-out breakdown
- desktop pairing controls

- [ ] **Step 7: Run focused tests**

Run:

- `node --test --experimental-strip-types src/components/focus/focus-app-groups.test.mjs src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-display.test.mjs`
- `pnpm exec playwright test e2e/focus-tracker.spec.ts --workers=1`

Expected: PASS

### Task 4: Update docs to match the redesign

**Files:**
- Modify: `README.md`
- Add: `docs/changelog/2026-03-31-focus-app-first-redesign.md`

- [ ] **Step 1: Update README**

Describe `/focus` as an App-first page:

- cumulative top apps
- selected-app drilldown
- day timeline as supporting context

- [ ] **Step 2: Add changelog entry**

Include:

- date
- task / goal
- key changes
- files touched
- verification commands and outcomes
- remaining risks

### Task 5: Final verification

**Files:**
- Modify if needed based on failures: any files touched above

- [ ] **Step 1: Run lint**

Run:

`pnpm exec eslint src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/components/focus/focus-app-groups.ts src/components/focus/focus-app-groups.test.mjs src/components/focus/focus-top-apps.ts src/components/focus/focus-display.ts e2e/focus-tracker.spec.ts README.md`

Expected: PASS

- [ ] **Step 2: Re-run tests**

Run:

- `node --test --experimental-strip-types src/components/focus/focus-app-groups.test.mjs src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-display.test.mjs`
- `pnpm exec playwright test e2e/focus-tracker.spec.ts --workers=1`

Expected: PASS

- [ ] **Step 3: Record actual results in the changelog**

Copy the real commands and outcomes into `docs/changelog/2026-03-31-focus-app-first-redesign.md`.
