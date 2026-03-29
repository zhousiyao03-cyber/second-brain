# 2026-03-29 Focus Tracker status alignment

## task / goal

- 修复桌面端状态和服务端 `/focus` 明显不一致的问题。
- 降低“看分享但被判成 idle”的误判概率。

## key changes

- 修改 `focus-tracker/src-tauri/src/outbox.rs`：
  - 新增 `recent_sessions`
  - 新增 `record_session(...)`
  - 关闭的 session 现在会同时进入：
    - `queued_sessions`：等待上传
    - `recent_sessions`：本地 today / timeline 展示
- 修改 `focus-tracker/src-tauri/src/state.rs`：
  - 桌面端 today total 和 timeline 改为基于 `recent_sessions + current_session`
  - 不再因为上传成功后从 queue 删除，就让本地 today total 变小
  - 补充单测覆盖“上传后本地 today 仍保留历史”
- 修改 `focus-tracker/src-tauri/src/lib.rs`：
  - 统一通过 `record_session(...)` 写入本地状态
  - 把 idle 阈值从 `5min` 放宽到 `30min`

## files touched

- `focus-tracker/src-tauri/src/outbox.rs`
- `focus-tracker/src-tauri/src/state.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-tracker-status-alignment.md`

## verification commands and results

- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 9 passed
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过

## remaining risks or follow-up items

- 这次修掉的是“本地展示口径”和“idle 阈值过紧”。
- macOS 仍然只能感知“用户输入空闲时间”，并不能真正知道用户是否在第二块屏上专注观看内容；只是现在不再在 5 分钟后立刻判 idle。
- 如果后续要更准确识别“被动观看也是专注”，需要单独定义产品语义，再决定是否引入媒体播放、会议应用白名单或更复杂的 activity heuristics。
