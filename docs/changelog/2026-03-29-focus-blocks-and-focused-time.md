# 2026-03-29 Focus blocks and focused time

## task / goal

- 让 `/focus` 默认展示可读的 work blocks，而不是把 `0m / 1m` 的碎片 session 直接摊给用户。
- 引入更接近 Rize 的展示口径：区分 block 的 `span` 和真正计入专注的 `focused` 时间。

## key changes

- 修改 `src/server/focus/aggregates.ts`
  - 新增 `FocusDisplaySession`
  - 新增 `buildDisplaySessionsFromSlices(...)`
  - display session 现在包含：
    - `spanSecs`
    - `focusedSecs`
    - `interruptionCount`
    - `rawSessionCount`
  - `buildDailyStats(...)` 现在同时返回：
    - 原始 `totalSecs`
    - `focusedSecs`
    - `spanSecs`
    - `displaySessions`
- 修改 `src/server/routers/focus.ts`
  - 新增 `focus.displaySessions`
  - `focus.dailyStats` 增加 `focusedSecs`、`spanSecs`、`displaySessionCount`
- 修改 `src/components/focus/focus-page-client.tsx`
  - `/focus` 默认主列表从 raw sessions 改为 merged `Focus blocks`
  - 顶部主指标改为 `focusedSecs`
  - block 列表会显示：
    - focused time
    - span time（当 span 大于 focused 时）
    - short interruption count
  - 原始 session 收进 `Raw activity` 折叠区
- 修改 dashboard：
  - Focus card 改为消费 `displaySessions`
  - 重点展示 focused time
- 修改 `src/components/focus/focus-shared.tsx`
  - top apps 聚合优先使用 `focusedSecs`
- 更新 `README.md`
- 更新 E2E 选择器，避免被 `Focus blocks` 标题撞到

## files touched

- `src/server/focus/aggregates.ts`
- `src/server/focus/aggregates.test.mjs`
- `src/server/routers/focus.ts`
- `src/components/focus/focus-page-client.tsx`
- `src/components/focus/focus-shared.tsx`
- `src/app/(app)/page.tsx`
- `e2e/focus-tracker.spec.ts`
- `README.md`
- `docs/changelog/2026-03-29-focus-blocks-and-focused-time.md`

## verification commands and results

- `node --test --experimental-strip-types src/server/focus/aggregates.test.mjs`
  - ✅ 5 passed
- `pnpm lint src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/app/'(app)'/page.tsx src/server/focus/aggregates.ts src/server/routers/focus.ts`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - ✅ 通过

## remaining risks or follow-up items

- 这次只改了 Web 展示层口径，底层 collector sessionizer 仍然会产出较碎的原始 session。
- 后续如果要让“focused time”更准确，需要继续把桌面端降噪、确认延迟、短中断 merge 做进采集链路。
- 现在 focused time 仍基于展示合并规则推导，不是独立的行为识别模型。
