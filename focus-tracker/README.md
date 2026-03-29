# Focus Tracker Tauri Collector

一个独立的 Tauri + React collector，用来把 Focus Tracker 的桌面采集链路跑通并常驻在本地。

当前能力：

- macOS 下通过 `osascript` 读取前台 app / window title
- Rust 侧 sessionize + collector-side denoise：
  - 新窗口需稳定 `10s` 才确认切换
  - `< 30s` 的 session 不单独入队
  - `Finder / focus-tracker / Rize / 系统窗口` 这类低权重 app 在 `< 2min` 时不会单独入队
- 本地 JSON outbox
- outbox 级别的相邻 session 合并：
  - 相同 app、间隔 `< 2min` 的片段会自动并成一段
  - `VS Code / Terminal / Docs / Postman` 这类 coding workflow 也会按任务组合并
- 本地 recent history，用来让 today total / timeline 不会在上传后归零
- 服务端日视图同步：
  - 配置 `base URL + token` 后，桌面端会周期性拉取 `/api/focus/status`
  - 面板上的 `Working Hours / Focused time / timeline` 会优先对齐服务端 canonical 数据
  - 本地未上传 session 会叠加到远端快照上，避免短时间内显示倒退
- 本地设置持久化
- 后台定时采样循环
- 采样与上传解耦：
  - 默认每 `5s` 采样一次
  - 默认每 `120s` 批量上传一次
  - 只在 outbox 里有待上传 session 时触发上传
- idle 判定更宽松：
  - 默认 `30min` 无输入才会把当前窗口视为 idle
- tray icon + 隐藏/显示面板
- 菜单栏顶栏摘要：
  - tray title 会直接显示 `Working Hours · 8h progress`
  - 不点开 panel 也能看到今天工作进度
- 标准 menubar popover 行为：
  - 点击 tray icon 时固定宽度 panel 会贴在状态栏图标下方
  - 自动做屏幕边界 clamp，避免在多屏或右侧边缘溢出
  - 失焦自动隐藏，按 `Esc` 也会收起
- 通过 bearer token 上传到 Second Brain 的 `/api/focus/ingest`
- React 面板支持：
  - working hours + focused time + 8h progress
  - compact local timeline
  - open `/focus`
  - setup needed / upload failed 时显示修复入口
  - 使用 `/focus` 生成的 pairing code

## 运行前提

- Rust toolchain
- Xcode Command Line Tools / Xcode
- 一个正在运行的 Second Brain Web app

服务端建议配置：

```bash
FOCUS_INGEST_API_KEY=your-focus-ingest-api-key
FOCUS_INGEST_USER_ID=your-user-id
```

如果你已经登录 Web 端并打开了 `/focus`，也可以直接在 “Desktop access” 区块生成一个 pairing code。新的配对流是：

1. 在 Web 端 `/focus` 点击 `Generate pairing code`
2. 在桌面端的 `Fix setup` 里粘贴这个 code
3. collector 会自动换成正式 device token 并保存到本地

这样桌面端就不需要共享全局 ingest key，也不会再暴露手动复制 token 的流程。若 token 被 revoke、过期或配对/上传被限流，collector 会直接显示重连或稍后重试的指引。

## 常用命令

```bash
pnpm install
pnpm build
pnpm tauri dev --no-watch
```

如果只想验证 Rust 侧逻辑：

```bash
cd src-tauri
cargo test
cargo check
```

可选环境变量：

```bash
FOCUS_COLLECTOR_SAMPLE_INTERVAL_SECS=5
FOCUS_COLLECTOR_UPLOAD_INTERVAL_SECS=120
```

## 目录说明

- `src-tauri/src/tracker.rs`：macOS 采样
- `src-tauri/src/sessionizer.rs`：session merge / flush
- `src-tauri/src/outbox.rs`：本地持久化
- `src-tauri/src/uploader.rs`：上传 `/api/focus/ingest`
- `src-tauri/src/state.rs`：共享运行时状态
- `src/App.tsx`：collector 控制面板
