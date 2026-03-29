# 2026-03-29 Focus Popup Height And Clipping

## Task / Goal

修正 Focus Tracker menubar popup 底部空白过多、底部圆角不完整，以及透明长方形边角残留的问题。

## Key Changes

- 在 `focus-tracker/src/App.css` 去掉依赖 `100vh` 的布局：
  - `body`、`#root` 不再强制占满整窗
  - 外层卡片改成内容驱动
  - 补了 `overflow: hidden`，确保圆角真实裁切
- 继续压缩 popup 底部占用：
  - 调小外边距和 summary/timeline 底部间距
- 在 `focus-tracker/src-tauri/tauri.conf.json` 把默认窗口高度从 `460` 收到 `360`
  - 让默认 popup 更接近一张紧凑的 menubar 状态卡，而不是高浮窗

## Files Touched

- `focus-tracker/src/App.css`
- `focus-tracker/src-tauri/tauri.conf.json`

## Verification

- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- 如果 setup 面板未来内容再变多，`360` 高度下可能需要继续做内部滚动。
- 这次改动主要修视觉裁切和默认高度，实际多屏和不同缩放下的边缘观感仍需要继续手测。
