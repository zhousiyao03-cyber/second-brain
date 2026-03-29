# 2026-03-29 Focus Tracker Tauri prototype

## task / goal

- 把 Focus Tracker 从仓库内的 Node collector prototype 往真实 Tauri runtime 推进。
- 至少做到：能编译、能启动、能在桌面端持有采样 / sessionize / outbox / upload 这条主链路。

## key changes

- 安装了 Rust toolchain，并完成 `focus-tracker/` Tauri v2 app scaffold。
- 在 `focus-tracker/src-tauri/` 下新增：
  - `tracker.rs`：通过 `osascript` 读取前台 app / window title 与 idle time
  - `sessionizer.rs`：会话合并与 flush，内含 Rust 单测
  - `outbox.rs`：本地 JSON outbox
  - `uploader.rs`：上传到 `/api/focus/ingest`
  - `state.rs`：共享运行时状态
- 重写 `focus-tracker/src-tauri/src/lib.rs`：
  - 暴露 `get_status`
  - 暴露 `collect_once`
  - 暴露 `flush_current_session`
  - 暴露 `load_demo_fixture`
  - 暴露 `upload_queue`
  - 增加 tray icon
  - 增加后台定时采样 / 自动上传循环
  - 窗口关闭时改为隐藏到 tray
- 扩展 `focus-tracker/src-tauri/src/state.rs`：
  - 增加 collector settings 持久化
  - 增加本地时区日切片与 today focus 聚合
  - 输出 timeline segments 给 menubar panel
  - 新增 Rust 单测覆盖 settings round-trip
- 重写 `focus-tracker/src/App.tsx` 和 `src/App.css`：
  - 替换掉脚手架默认 greet 页面
  - 改成更接近 menubar 的紧凑面板
  - 增加 today total / progress / current activity / upload state
  - 增加紧凑 timeline 与打开 `/focus` 的入口
  - 支持保存 uploader 设置
- 重写 `focus-tracker/README.md`，移除脚手架默认文档。
- 更新主仓库 `README.md`，记录 `focus-tracker/` 的存在与当前状态。

## files touched

- `focus-tracker/README.md`
- `focus-tracker/package.json`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `focus-tracker/src-tauri/Cargo.toml`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/src/tracker.rs`
- `focus-tracker/src-tauri/src/sessionizer.rs`
- `focus-tracker/src-tauri/src/outbox.rs`
- `focus-tracker/src-tauri/src/uploader.rs`
- `focus-tracker/src-tauri/src/state.rs`
- `README.md`
- `docs/changelog/2026-03-29-focus-tracker-tauri-prototype.md`

## verification commands and results

- `rustc --version`
  - ✅ `rustc 1.94.1 (e408947bf 2026-03-25)`
- `cargo --version`
  - ✅ `cargo 1.94.1 (29ea6fb6a 2026-03-24)`
- `cd focus-tracker && pnpm install`
  - ✅ 成功安装前端依赖
- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 6 passed
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过
- `cd focus-tracker && pnpm build`
  - ✅ 通过
- `cd focus-tracker && pnpm tauri dev --no-watch`
  - ✅ Vite dev server 启动成功
  - ✅ Rust binary `target/debug/focus-tracker` 启动成功

## remaining risks or follow-up items

- 现在已经是 tray + background loop 原型，UI 也收敛成紧凑 panel，但还没做真正贴边定位的 menubar dropdown 行为。
- 自动上传现在基于固定 bearer token，还没做设备注册、token 刷新或更细的权限模型。
- 失败重试当前依赖 outbox 留存和后续上传，不是带指数退避的完整任务调度器。
