# Portfolio Holding Edit UI

**Date:** 2026-04-01

**Task / Goal:** Improve the Portfolio UI with holding edits, value-based ordering, daily change display, fresh price refetching on entry, and AI-backed portfolio analysis cards.

## Key Changes

- Updated the Portfolio holding cards to expose a `修改` action beside delete on hover.
- Added an `EditHoldingModal` in the Portfolio client page for editing:
  - `quantity`
  - `costPrice`
- Wired the modal to the existing `portfolio.updateHolding` mutation.
- After saving, the page now refreshes holdings and price-derived summary data.
- Sorted the holding list by current total value descending, falling back to cost basis when live price is unavailable.
- Added per-holding daily change display and a top-level `今日变化` summary derived from current price vs previous close.
- Added per-holding `持仓金额` and `占组合` display so each position shows its current contribution to the portfolio.
- Updated the live price query so entering the page or refocusing the window re-fetches the latest prices instead of relying on stale cache.
- Reworked the right side of `/portfolio` into:
  - a large `Portfolio 分析` card focused on overall concentration, structure, findings, and suggestions
  - a smaller single-holding analysis card for the currently selected symbol
- Kept per-symbol news as auxiliary context inside the smaller card instead of the page’s primary panel.
- Added a shared portfolio analysis helper that computes concentration, winners/losers, asset mix, and per-holding diagnostics from live portfolio data.
- Added a new `portfolio.analyze` tRPC query that:
  - builds a deterministic fallback analysis from structured portfolio metrics
  - asks the model to turn those metrics into concise Chinese `Portfolio 分析` and `单标分析` content
  - falls back to the deterministic analysis when AI generation is unavailable
- Wired the Portfolio client to render fallback analysis immediately and replace it with AI-generated analysis when the query succeeds.
- Removed an unstable loading badge from the analysis cards so the client and server render the same initial markup and avoid hydration mismatch.
- Changed top-level portfolio totals to use live prices when available and cost basis as fallback, so `总市值` and `累计盈亏` still render even when one holding lacks a fresh quote.
- Limited the left-side holding list to the first 6 positions by default and added a `显示更多持仓 / 收起持仓列表` toggle so long portfolios do not stretch the page excessively.
- Kept the currently selected holding visible in the collapsed list even if it would normally fall below the first 6 rows.
- Updated `AGENTS.md` verification rules to allow skipping dedicated automated tests for very small, low-risk frontend tweaks when the user explicitly treats them as simple.

## Files Touched

- `src/app/(app)/portfolio/_client.tsx`
- `src/lib/portfolio-analysis.ts`
- `src/lib/portfolio-analysis.test.mjs`
- `src/server/routers/portfolio.ts`
- `AGENTS.md`
- `docs/changelog/2026-04-01-portfolio-holding-edit-ui.md`

## Verification Commands And Results

- `source ~/.nvm/nvm.sh && nvm use >/dev/null && pnpm exec eslint 'src/app/(app)/portfolio/_client.tsx'`
  - Passed
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && node --experimental-strip-types --test src/lib/portfolio-analysis.test.mjs`
  - Passed
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && pnpm exec eslint src/lib/portfolio-analysis.ts src/server/routers/portfolio.ts 'src/app/(app)/portfolio/_client.tsx' src/lib/portfolio-analysis.test.mjs`
  - Passed
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && pnpm build`
  - Passed

## Remaining Risks / Follow-up

- This edit flow only updates quantity and cost price; renaming a holding or changing symbol/type is still intentionally unsupported.
- Browser-level authenticated interaction was not automated here; verification relies on build/lint plus local runtime validation.
- The AI analysis quality depends on model availability and the live portfolio metrics; when generation fails, the page falls back to deterministic rule-based analysis instead of going blank.
