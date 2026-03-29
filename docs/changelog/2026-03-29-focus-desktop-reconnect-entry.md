# 2026-03-29 Focus Desktop Reconnect Entry

## Task / Goal

让桌面端 menubar panel 在正常已绑定状态下也能随时重新配对，不再把设备设置入口只藏在错误态里。

## Key Changes

- 在桌面端面板顶部新增常驻 `Reconnect` / `Fix setup` 按钮
- 已绑定状态下也可以主动展开设备设置区域
- 设备设置面板支持手动关闭，不再依赖错误态自动出现

## Files Touched

- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `docs/changelog/2026-03-29-focus-desktop-reconnect-entry.md`

## Verification Commands And Results

- `cd focus-tracker && pnpm build`
  - passed
- `cd focus-tracker && PATH="/opt/homebrew/opt/rustup/bin:$PATH" FOCUS_TRACKER_START_VISIBLE=true pnpm tauri dev --no-watch`
  - passed
  - `target/debug/focus-tracker` started successfully

## Remaining Risks / Follow-up

- 这次只补了重连入口，还没有做正式桌面端安装包和自动更新。
- 如果用户完全退出桌面端进程，仍需要通过开发命令或未来正式安装包重新启动应用。
