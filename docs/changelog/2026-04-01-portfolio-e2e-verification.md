# Portfolio E2E Verification

**Date:** 2026-04-01

**Task / Goal:** Reproduce and validate the main `/portfolio` risks reported from production feedback, especially AI analysis visibility, portfolio totals unexpectedly clearing, long holding-list behavior, and edit-flow stability.

## Key Changes

- Added a dedicated end-to-end Portfolio scenario in `e2e/portfolio.spec.ts`.
- The test covers one continuous user flow:
  - seed holdings through the real `portfolio.addHolding` tRPC mutation
  - verify `Portfolio 分析` and `单标分析` render with `AI 生成 / 规则兜底`
  - verify top-level totals still render correctly when holdings have no live quote and must fall back to cost basis
  - verify the left holding list collapses by default and expands on demand
  - verify editing a holding updates the aggregate summary without blanking the page
- Added `e2e/prepare-portfolio-db.mjs` to prepare a clean isolated SQLite DB and seed the E2E bypass user.
- Added `playwright.portfolio.manual.config.ts` so the Portfolio E2E can run against a manually started isolated server on port `3300` without conflicting with an already running local `next dev`.

## Files Touched

- `e2e/portfolio.spec.ts`
- `e2e/prepare-portfolio-db.mjs`
- `playwright.portfolio.manual.config.ts`
- `docs/changelog/2026-04-01-portfolio-e2e-verification.md`

## Verification Commands And Results

- `source ~/.nvm/nvm.sh && nvm use >/dev/null && pnpm exec eslint e2e/portfolio.spec.ts playwright.portfolio.manual.config.ts e2e/prepare-portfolio-db.mjs`
  - Passed
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && node e2e/prepare-portfolio-db.mjs`
  - Passed
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && SQLITE_DB_PATH='/Users/bytedance/second-brain/data/test/second-brain.e2e.db' TURSO_DATABASE_URL='file:/Users/bytedance/second-brain/data/test/second-brain.e2e.db' AUTH_BYPASS=true AUTH_BYPASS_USER_ID=test-user AUTH_TRUST_HOST=true ENABLE_TOKEN_USAGE=false NEXT_PUBLIC_ENABLE_TOKEN_USAGE=false NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS=1000 pnpm start --port 3300`
  - Passed, server started on `http://127.0.0.1:3300`
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && PLAYWRIGHT_HTML_OPEN=never pnpm exec playwright test e2e/portfolio.spec.ts --config=playwright.portfolio.manual.config.ts`
  - Passed, `1 passed (25.4s)`

## Findings

- In the isolated end-to-end run, the current Portfolio page did **not** reproduce a bug where AI analysis never appears; the page rendered `AI 生成`/`规则兜底` status correctly.
- In the isolated end-to-end run, the current Portfolio page did **not** reproduce a bug where top-level portfolio totals clear to zero when quotes are unavailable; the page correctly fell back to cost basis.
- The previous attempt to rely on Playwright's `webServer` wrapper for this page was unreliable in this repository because it conflicted with local-running Next processes and made env propagation harder to trust. The manual isolated-server path was stable and reproducible.

## Remaining Risks / Follow-up

- This E2E scenario currently validates the main Portfolio path as one long user flow; if the page keeps changing, it may be worth splitting it into smaller Portfolio-specific specs once the test environment around `/portfolio` stabilizes.
- The test intentionally uses no-quote symbols to make totals deterministic; it does not validate Yahoo/CoinGecko upstream data correctness.
