# 2026-03-29 Focus Desktop Single-Field Pairing

## Task / Goal

把桌面端的配对 UI 收敛成单输入流，避免在正常用户路径里暴露 `Base URL`、`Device ID`、`Time zone` 这类实现细节。

## Key Changes

- `Reconnect / Fix setup` 面板现在只保留 `Pairing code` 输入框
- `Base URL` 改为内部使用当前 collector 配置，不再在 UI 中展示
- `Device ID` 和 `Time zone` 继续由桌面端自动提供，但不再暴露给用户

## Files Touched

- `focus-tracker/src/App.tsx`
- `docs/changelog/2026-03-29-focus-desktop-single-field-pairing.md`

## Verification Commands And Results

- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- 这次只是收敛 UI，不影响底层配对协议。
- 生产版桌面端后续仍建议把默认 `Base URL` 固定到线上域名，仅在开发模式下保留可配置能力。
