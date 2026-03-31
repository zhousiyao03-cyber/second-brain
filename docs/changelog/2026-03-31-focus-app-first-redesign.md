# 2026-03-31 Focus App-First Redesign

## date

- 2026-03-31

## task / goal

- 把 `/focus` 从“focus 指标页”重做成更直接的 App-first 页面，优先回答“今天时间主要花在哪些 App 上”。

## key changes

- 新增 `src/components/focus/focus-app-groups.ts`
  - 提供 raw session 按 app 聚合、默认选中 app、选中 app 详情推导等 helper。
- 新增 `src/components/focus/focus-app-groups.test.mjs`
  - 覆盖 app 聚合排序、百分比、默认选中 app、最长 session、first seen / last seen 推导。
- 重做 `src/components/focus/focus-page-client.tsx`
  - 页面主顺序改成：
    - compact summary
    - `Top apps`
    - `Selected app detail`
    - `Day timeline`
    - `Daily summary`
    - `Filtered out`
    - `Desktop access`
  - `Top apps` 变成主视图，每行可点击选中。
  - 默认自动选中 top app。
  - 新增 selected app detail 卡片，展示：
    - app 今日总时长
    - session count
    - longest session
    - first seen / last seen
    - app-only mini timeline
    - session list
- 修改 `src/components/focus/focus-shared.tsx`
  - `FocusTimeline` 支持高亮当前选中的 app，其余 app 降低透明度。
- 更新 `e2e/focus-tracker.spec.ts`
  - 验证 `/focus` 默认会展示 top app 详情
  - 验证点击不同 app 后，detail panel 会切换到对应 app
- 更新 `README.md`
  - 把 `/focus` 的说明改成 App-first 结构

## files touched

- `src/components/focus/focus-page-client.tsx`
- `src/components/focus/focus-shared.tsx`
- `src/components/focus/focus-app-groups.ts`
- `src/components/focus/focus-app-groups.test.mjs`
- `e2e/focus-tracker.spec.ts`
- `README.md`
- `docs/superpowers/plans/2026-03-31-focus-app-first-redesign.md`
- `docs/changelog/2026-03-31-focus-app-first-redesign.md`

## verification commands and results

- `pnpm exec eslint src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/components/focus/focus-app-groups.ts src/components/focus/focus-app-groups.test.mjs e2e/focus-tracker.spec.ts`
  - ✅ passed
- `node --test --experimental-strip-types src/components/focus/focus-app-groups.test.mjs src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-display.test.mjs`
  - ✅ 8 passed
- `pnpm exec playwright test e2e/focus-tracker.spec.ts --workers=1`
  - ✅ 2 passed

## remaining risks or follow-up items

- 当前 App-first 页面仍按 `appName` 聚合；浏览器内部的 host / page title 细分只在 selected app 的 session 明细里体现，还没有进入更细粒度的 leaderboard。
- 现在 desktop 宽屏使用两列布局，如果后续发现右侧信息密度还是偏低，可以再收回单列版本做第二轮排版收敛。
