# 2026-03-29 Focus Menubar Title And Popup Polish

## Task / Goal

把 Focus Tracker 桌面端收成更像正式 menubar app 的状态：菜单栏顶栏直接显示工作时长和 8 小时进度，panel 失焦时自动隐藏，并继续压缩 popup 的信息密度和视觉层级。

## Key Changes

- 在 `focus-tracker/src-tauri/src/lib.rs` 新增 tray title 格式化与刷新逻辑：
  - 菜单栏顶栏直接显示 `Working Hours · 8h progress`
  - 后台采样/上传循环每轮都会刷新 tray title
  - app 启动后会立即同步一次 tray title
- 修正 panel 的失焦隐藏逻辑：
  - 即使启用了 `FOCUS_TRACKER_START_VISIBLE=true` 手测模式，窗口失焦后也会正常收起
- 收紧桌面端 popup 视觉结构：
  - 面板改成单层容器，减少之前双层背景带来的“奇怪外框感”
  - 保留 `Working Hours`、`Focused time`、8 小时进度、timeline、`Reconnect`、`Open /focus`
  - setup 面板仍然按需展开，但不再把无关状态卡堆在主视图
- 在 `tauri.conf.json` 为主窗口开启 `transparent`，配合前端透明背景和单层容器，减少矩形底色感

## Files Touched

- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/tauri.conf.json`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `focus-tracker/README.md`
- `README.md`

## Verification

- `cd focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - `26 passed`
- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- tray title 会占用菜单栏宽度，用户状态项很多时仍可能被系统挤压；后续如果反馈明显，可以再缩成更短格式。
- 窗口透明在 macOS dev/runtime 下已通过构建验证，但仍需要一轮真实手测确认阴影、点击穿透和圆角观感是否稳定。
