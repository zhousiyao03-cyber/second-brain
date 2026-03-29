# 2026-03-29 Focus Tracker canonical sync

## task / goal

- 修复桌面端 Today 卡片和 `/focus` 页面口径不一致的问题。
- 让桌面端在连接服务端时，优先显示服务端 canonical 日统计，而不是只看本地 collector 缓存。

## key changes

- 新增 `src/app/api/focus/status/route.ts`
  - 支持通过桌面端 device token / 全局 ingest key 获取当天 focus 状态
  - 返回当天 `totalSecs`、`sessionCount`、`sessions`
- 修改 `focus-tracker/src-tauri/src/state.rs`
  - 新增 `server_day_snapshot`
  - Today total / timeline 现在会优先使用远端日快照
  - 仍会叠加本地 recent history 和当前 session，避免刚采样但未上传时显示落后
- 新增 `focus-tracker/src-tauri/src/status_sync.rs`
  - 定时拉取 `/api/focus/status`
- 修改 `focus-tracker/src-tauri/src/lib.rs`
  - 后台循环里增加状态同步
  - 默认每 30 秒刷新一次服务端日状态
- 更新 `focus-tracker/README.md`

## files touched

- `src/app/api/focus/status/route.ts`
- `focus-tracker/src-tauri/src/state.rs`
- `focus-tracker/src-tauri/src/status_sync.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-tracker-canonical-sync.md`

## verification commands and results

- `curl -H 'Authorization: Bearer focus-test-key' 'http://127.0.0.1:3200/api/focus/status?...'`
  - ✅ 返回当天 canonical focus 数据
- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 10 passed
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- 桌面端当前还是“服务端快照 + 本地增量”的近实时模型，不是 websocket 或 server push。
- 如果 `/focus` 页面里包含很早之前的测试/demo 数据，桌面端同步后也会显示同一份数据；这属于测试数据清理问题，不是口径 bug。
