# 2026-03-29 Focus Tracker Menubar Popover

## Task / Goal

把 Tauri 桌面端从“无边框浮窗”收成更像标准 macOS menu bar app 的 popover：点击 tray icon 后贴着状态栏弹出，默认是更窄、更轻的状态面板。

## Key Changes

- 在 `focus-tracker/src-tauri/src/lib.rs` 新增 tray click 锚点定位逻辑：
  - 使用 `TrayIconEvent::Click` 提供的 click position 和 tray rect 做 panel 定位
  - 按 monitor work area 做边界 clamp，避免 panel 从屏幕右侧或多屏边界溢出
  - 新增 `hide_panel` 命令，供前端触发收起
- 在 `focus-tracker/src-tauri/tauri.conf.json` 把主窗口尺寸收成更标准的 popover 规格：
  - 宽度 `368`
  - 高度 `460`
  - 禁用 maximize / minimize
- 在 `focus-tracker/src/App.tsx` 新增 `Esc` 收起行为。
- 在 `focus-tracker/src/App.css` 收紧 panel 布局和视觉密度，让它更接近标准 menubar popup。
- 为 popover 定位逻辑新增 Rust 单测，验证居中和边界 clamp。

## Files Touched

- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/tauri.conf.json`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `focus-tracker/README.md`
- `README.md`

## Verification Commands And Results

- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `18 passed`
- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo check`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker && PATH="/opt/homebrew/opt/rustup/bin:$PATH" pnpm tauri dev --no-watch`
  - Passed startup check
  - `target/debug/focus-tracker` launched successfully

## Remaining Risks / Follow-up

- 这版是 anchored popover，但还不是原生 `NSPopover` 级别的系统组件。
- 多屏和不同菜单栏高度下的视觉体验还需要你实际手测。
- 设置仍然复用主 panel 的异常态展开，还没有拆成独立 settings window。
