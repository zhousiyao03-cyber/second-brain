# 2026-03-29 Focus Popup Expand On Setup

## Task / Goal

修正 Focus Tracker menubar popup 在点击 `Reconnect` / setup 后内容被窗口高度裁掉的问题。

## Key Changes

- 在 `focus-tracker/src-tauri/src/lib.rs` 新增 `set_panel_expanded` 命令：
  - 默认保持紧凑高度
  - setup / attention 态时自动把窗口高度扩展到更大的面板尺寸
- 在 `focus-tracker/src/App.tsx` 增加前端联动：
  - 当 `showSetup` 或 `uploadNeedsAttention` 为真时，自动调用 Tauri 命令展开窗口
  - 收起 setup 后自动恢复为默认紧凑高度

## Files Touched

- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src/App.tsx`

## Verification

- `cd focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - `26 passed`
- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- 当前是两档高度切换，不是内容精确自适应；如果 setup 内容后续再增加，可能还要再调展开高度。
- 展开后仍然沿用当前 popover 锚点，不会重新按 tray 位置二次校准高度变化。
