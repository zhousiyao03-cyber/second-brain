# Portfolio Task 4 — GPT News Aggregation with Vercel Cron

**Date:** 2026-04-01
**Task:** Implement `refreshNews` procedure and Vercel Cron handler for daily AI news summaries

## Key Changes
- Added `generatePortfolioNews` exported helper to `portfolio.ts`: calls `generateStructuredData` with a Chinese news summary prompt, upserts result into `portfolioNews` table
- Replaced placeholder `refreshNews` with full implementation including 1-hour debounce (skips AI call if fresh data exists within the hour)
- Created `src/app/api/cron/portfolio-news/route.ts`: GET handler secured by `CRON_SECRET`, iterates all holdings, generates news for each
- Created `vercel.json` with daily midnight UTC cron schedule

## Files Touched
- `src/server/routers/portfolio.ts`
- `src/app/api/cron/portfolio-news/route.ts` (new)
- `vercel.json` (new)

## Verification
- `pnpm build`: ✅ passed

## Residual Risks
- Cron path bypasses the 1-hour debounce in `refreshNews` — cron always regenerates on schedule
- No cross-user symbol deduplication: if multiple users hold BTC, each gets a separate AI call
- Upsert in `generatePortfolioNews` is non-atomic (read then insert/update) — low risk at current scale
- `CRON_SECRET` must be set in Vercel project settings before deploying
