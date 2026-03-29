# 2026-03-29 Focus Tracker upload batching

## task / goal

- 确认桌面端当前上传节奏。
- 把上传从“跟着采样频率走”改成“低频批量上传”，避免窗口切换时过于频繁地请求 `/api/focus/ingest`。

## key changes

- 修改 `focus-tracker/src-tauri/src/state.rs`：
  - 新增 `upload_interval_secs`
  - 默认值为 `120` 秒
  - 支持通过 `FOCUS_COLLECTOR_UPLOAD_INTERVAL_SECS` 覆盖
  - 新增 `should_auto_upload(...)`，按 outbox 积压时间判断是否该自动上传
- 修改 `focus-tracker/src-tauri/src/lib.rs`：
  - `auto_collect_and_upload(...)` 现在仍会按采样间隔采集
  - 但只有在达到上传窗口时才会真正调用 `/api/focus/ingest`
- 更新 `focus-tracker/README.md`：
  - 写明默认是 `5s` 采样、`120s` 上传
  - 补充可选环境变量说明

## files touched

- `focus-tracker/src-tauri/src/state.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-tracker-upload-batching.md`

## verification commands and results

- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 5 passed
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过
- `cd focus-tracker && pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- 这次改的是“上传频率”，不是“session 合并规则”。
- 如果用户频繁切换不同窗口，session 仍然会按窗口边界切开；只是这些 session 不会再每次切换都立即上传。
- 如果后续还要进一步减少 session 碎片，需要单独定义“相邻同类 session 合并”的产品和统计语义。
