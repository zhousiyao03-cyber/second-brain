# 2026-04-18 — Landing page screenshot band

## Goal

The P0 follow-up from `2026-04-18-landing-page-hosted-product-pivot.md` was
"add real product screenshots under the hero." The hosted landing copy was
solid but the page had no visual product shots — just text and feature cards.
A screenshot band raises both conversion (visitors see what they'd actually
get) and SEO (alt text = indexable content).

## Setup

To produce clean screenshots, I seeded the local dev account with realistic
demo data:
- `scripts/seed-demo.ts` — idempotent seed that populates the local dev
  test account (`test@secondbrain.local`) with 7 notes across 4 folders
  (one hero-quality note with Mermaid + TOC + Callout + Code + Table +
  Toggle + wiki-link), 4 OS projects with AI summaries, 3 learning topics
  with 8 sub-notes, 30 days of focus sessions + daily summaries (realistic
  weekday/weekend split, one anomaly day), and 30 days of token usage
  across claude-code + codex models.
- `.env.local` (gitignored) — local dev env with all feature flags on and
  a dev-only `AUTH_SECRET`.

## Key changes

- `public/screenshots/` (new)
  - `home.png` — Home dashboard: Today's Focus progress, 30-day heatmap,
    recent notes.
  - `notes.png` — Notes list with Explorer showing Engineering / Product /
    Reading / Prompts folders.
  - `focus.png` — Focus page: 30-day heatmap, streak, daily recent-days bar
    chart.
  - `usage.png` — Usage page: input / output / cache-read / cache-write
    totals, estimated cost, activity heatmap, daily token + cost charts.
- `src/components/marketing/landing-page.tsx`
  - New `Product shots` section inserted between the hero and the existing
    social-proof band.
  - Layout: one full-width hero shot (`home.png`), then a 3-column row on
    desktop (`notes.png` / `focus.png` / `usage.png`) with captions.
  - Alt text on every image — describes what's visible, which both serves
    screen readers and gives Google indexable content for the page.
  - Uses `next/image` with explicit width/height + `priority` on the hero
    shot, so CLS stays low and LCP benefits from preload.

## Files touched

- `scripts/seed-demo.ts` — new (~1000 lines), covers all dashboards.
- `public/screenshots/{home,notes,focus,usage}.png` — new.
- `src/components/marketing/landing-page.tsx` — new `Product shots`
  section between the hero and social-proof.
- `docs/changelog/2026-04-18-landing-screenshots.md` — this file.

## Verification

- `pnpm build` — clean, 0 errors.
- SSR HTML check on `http://localhost:3200/`:
  - 4 `alt` attributes present (Home / Notes / Focus / Usage).
  - 4 `/_next/image?url=%2Fscreenshots/...` sources present (Next's
    optimizer is wrapping them — correct, not a regression).
- Static asset check:
  - `GET /screenshots/home.png` → 200
  - `GET /screenshots/notes.png` → 200
  - `GET /screenshots/focus.png` → 200
  - `GET /screenshots/usage.png` → 200
- `pnpm test:e2e` — skipped. The Playwright harness still fails on this
  Windows workstation because of the known SQLite EBUSY issue on
  `data/second-brain.e2e.db`. This change is a pure marketing-component
  edit (no new server logic, no schema, no data path), so the curl-based
  SSR assertions above are the next-best executable verification.

## Follow-ups

- Portfolio page is hard-coded Chinese (violates CLAUDE.md "all
  user-facing copy must be English"). Separate fix.
- Home dashboard "AI → KNOWLEDGE" stat shows 0 because seeded notes do
  not trigger the knowledge indexer. Either seed `knowledge_chunks`
  directly, or run the indexer once against seeded notes, if we want the
  number to look realistic in future screenshots. Not blocking this task.
- No production schema changes.
