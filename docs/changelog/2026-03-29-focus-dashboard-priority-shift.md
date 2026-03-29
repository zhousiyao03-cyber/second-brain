# 2026-03-29 Focus Dashboard Priority Shift

## Task / Goal

把 `/focus` 顶部仪表盘从“分析指标优先”改成“目标与结果优先”，优先回答用户最关心的两件事：是否达到 8 小时标准，以及今天实际工作了多久。

## Key Changes

- 顶部主卡改为 `8h Goal`，直接显示完成百分比和距离 8 小时还差多少
- 第二张主卡保留 `Working Hours`，强调今天实际工作时长
- `Longest streak`、`Focus blocks`、`App switches` 降级为次级 pill 信息，不再占主卡位

## Files Touched

- `src/components/focus/focus-page-client.tsx`
- `docs/changelog/2026-03-29-focus-dashboard-priority-shift.md`

## Verification Commands And Results

- `pnpm build`
  - passed

## Remaining Risks / Follow-up

- 这次收的是信息层级，不改变底层统计定义。
- 如果后续确认用户几乎不关心 streak / switches，这些次级指标还可以继续下沉到折叠区。
