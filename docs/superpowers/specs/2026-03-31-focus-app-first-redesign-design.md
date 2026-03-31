# Focus App-First Redesign Design

## Goal

Redesign `/focus` so it behaves like a daily app time ledger instead of a derived “focus metrics” dashboard.

The main question the page should answer is:

- where did my time go today?

## Product Problem

The current `/focus` page still carries the structure of an earlier “focus quality” dashboard:

- a large hero area
- multiple secondary metrics
- a wide day timeline
- a long activity list
- AI summary promoted too high

That structure made more sense when the page tried to explain `focused time`, `span`, interruptions, and merged focus blocks.

Now that the product direction has been simplified to cumulative app time, the page is mismatched:

1. the highest-visibility area does not show the most useful information
2. the timeline occupies a lot of space before the user even knows which apps dominated the day
3. the session list appears before the user has chosen what they want to inspect
4. AI summary is promoted before the user has formed a basic picture of the day

The result is that the page still feels like a generic dashboard instead of a concrete “today by app” tool.

## Design Direction

We will redesign `/focus` into an **App-first** page.

The reading order should be:

1. today’s total tracked time
2. which apps took the most time
3. details for one selected app
4. global day distribution
5. optional AI summary and auxiliary tools

This makes the page easier to scan and easier to trust because it starts with the simplest, most explainable aggregate: cumulative app time.

## Primary User Questions

The page should answer these in order:

1. How much time was recorded today?
2. Which apps consumed the most time?
3. For a given app, when was it used and in how many sessions?
4. What did the whole day look like across all apps?
5. If needed, what does the AI summary say about the day?

## Information Hierarchy

### 1. Header summary

The top section should become compact and factual.

It should show:

- selected date
- `Tracked today`
- `Working hours`
- `Filtered out`

It should not foreground:

- 8h goal
- longest streak
- app switches
- display session count

Those metrics can still exist in data, but they should not lead the page because they are not the user’s primary question anymore.

### 2. Top apps as the main module

The first major module should be an app ranking list.

Each row should include:

- app name
- cumulative duration
- percentage of tracked day
- a horizontal bar

Behavior:

- default to top 10 apps
- support `Show all apps`
- support selecting an app row
- selected row should have a clear visual active state

This becomes the main entry point into the rest of the page.

### 3. Selected app detail

Below the app ranking, show a dedicated detail panel for the currently selected app.

If the user has not clicked anything yet:

- auto-select the top app

The detail panel should include:

- app name
- today total duration
- session count
- longest session
- first seen / last seen time
- mini timeline for that app only
- session list in reverse chronological or chronological order

Each session row should show:

- start and end time
- duration
- secondary label such as window title or browser host when available

This turns the old `Activity blocks` concept into a contextual drill-down instead of a top-level wall of rows.

### 4. Global day timeline as secondary context

Keep a full-day timeline, but demote it below app ranking and selected-app detail.

Purpose:

- help the user understand how the day was distributed overall
- provide context after the user already knows which app they care about

Behavior:

- each segment represents a raw recorded session
- the selected app is highlighted
- non-selected apps are visually muted

This makes the timeline support the app analysis instead of competing with it.

### 5. AI summary and tools as tertiary modules

`Daily summary`, device tools, and classification actions should remain available, but lower on the page.

Reason:

- the user must first see the plain evidence
- AI explanation should come after the raw picture is clear

## Proposed Page Structure

Top to bottom:

1. compact summary header
2. top apps leaderboard
3. selected app detail
4. global day timeline
5. AI summary
6. filtered-out breakdown
7. desktop pairing / device management

## Layout Notes

### Desktop

Recommended structure:

- top summary spans full width
- main content becomes a two-column layout:
  - left: top apps + selected app detail
  - right: day timeline + filtered-out + summary

Alternative:

- keep a single-column flow if implementation simplicity is more important

Recommendation:

- use a two-column layout only if the selected app panel has enough height to justify it
- otherwise a strong single-column stack is preferable to avoid another “dashboard quilt”

### Mobile

On mobile, use a single-column stack:

1. summary
2. top apps
3. selected app detail
4. day timeline
5. summary and auxiliary cards

The selected app panel should stay readable without horizontal overflow.

## Data Semantics

The page should use these display rules:

- `Tracked today` = cumulative duration of all raw sessions for the selected day
- `Top apps` = group raw sessions by app name and sum `durationSecs`
- app detail session list = raw sessions for the selected app
- global timeline = raw sessions positioned by true time of day
- `Working hours` and `Filtered out` remain auxiliary derived metrics

This is important: the redesign must keep the page semantically consistent with the new promise, which is “direct cumulative app time,” not “best-effort attention inference.”

## Empty and Edge States

### No sessions for the day

Show:

- `Tracked today: 0m`
- empty top apps state
- empty selected app detail state
- empty day timeline

Do not show a large blank analytics shell.

### Many short sessions

Top apps should still work well even if most sessions are short.

The selected app session list can still collapse extremely short rows if needed, but the total app time must remain accurate and obvious.

### Browser-heavy usage

For browser sessions:

- primary grouping remains app-level unless a future version explicitly adds browser sub-grouping
- secondary label may use host or page title in the selected app detail list

Do not reintroduce semantic pseudo-apps into the main leaderboard in this redesign.

## Non-Goals

- bringing back `focused time` as the main display concept
- restoring merged semantic focus blocks as the top-level list
- turning the page into a productivity scorecard
- introducing category-level rollups in the first redesign pass

## Validation Plan

The redesign should be considered successful if the page can be scanned in this order without ambiguity:

1. total tracked time is immediately visible
2. top apps are visible without scrolling past a large timeline
3. one app can be inspected in detail without reading the entire day list
4. the day timeline helps confirm timing rather than introducing another competing summary

Executable validation should include:

- unit coverage for app grouping and selected-app helper logic
- Playwright coverage for:
  - top app list renders as the primary view
  - first app is auto-selected
  - selecting another app updates detail panel
  - timeline highlights selected app
  - journal/date navigation still works on the page

## Open Choices

These are the only design decisions still open for implementation planning:

1. whether the main body should be single-column or two-column on desktop
2. whether selected app sessions should be chronological or reverse chronological
3. whether `Filtered out` belongs above or below `Daily summary`

Recommendation:

- single-column if implementation speed matters most
- chronological session order for easier day reconstruction
- `Filtered out` below `Daily summary`

## Recommendation

Proceed with a **single-column App-first redesign** first.

That version is the clearest and lowest-risk:

- simpler hierarchy
- fewer layout conflicts
- easier mobile behavior
- faster to verify

If the page proves too long afterward, a second pass can split it into columns without changing the underlying information model.
