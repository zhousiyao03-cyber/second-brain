# 2026-03-29 Focus Desktop Primary UI Simplification

## Task / Goal

收敛桌面端 menubar 主视图，移除不必要的 `Current` 和 `Upload` 主信息卡，避免把调试状态当成产品主内容。

## Key Changes

- 从主面板移除了 `Current` 和 `Upload` 两张状态卡
- 主视图只保留 `Working Hours`、`Focused time`、进度、时间线和主要操作
- 上传/连接状态改成时间线下方的一行次级提示，只有异常时才高亮

## Files Touched

- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `docs/changelog/2026-03-29-focus-desktop-primary-ui-simplification.md`

## Verification Commands And Results

- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- 这次只收敛了信息层级，还没把 `Base URL` 从正式 UI 隐藏。
- 桌面端正式发布形态仍需后续补安装包和签名流程。
