# 2026-03-29 Focus Tracker Desktop Alignment

## Task / Goal

让 Tauri 桌面端的主面板和 `/focus` 使用同一层 canonical 语义，避免桌面端继续只显示原始 session 总和；同时在 collector 本地 outbox 上进一步合并相邻 workflow 片段，减少碎片 session。

## Key Changes

- `/api/focus/status` 新增 `focusedSecs`、`workHoursSecs` 和 `displaySessions`，让桌面端可以直接拉服务端 canonical 日统计，而不只是原始 session 列表。
- Tauri 侧的 `ServerDaySnapshot` 和状态同步逻辑改为保存 canonical focused/work/display block 数据。
- 桌面端 `TrackerStatus` 改为输出 `todayFocusedSecs` 和 `todayWorkSecs`，主面板 headline 改成 `Working Hours`，同时显示 `Focused time`。
- 桌面 timeline 优先消费服务端 `displaySessions`，本地未同步 session 作为 overlay 叠加，减少桌面端与 `/focus` 的口径偏差。
- collector outbox 新增相邻 session 合并规则：
  - 相同 app、间隔 `< 2min` 的片段自动合并
  - `coding / research / design / writing` 这类相邻 workflow 片段在短间隔下也会合并
- 更新 collector 和仓库 README，补充 canonical working hours / focused time 和 outbox merge 的说明。

## Files Touched

- `src/app/api/focus/status/route.ts`
- `focus-tracker/src-tauri/src/status_sync.rs`
- `focus-tracker/src-tauri/src/state.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/src/outbox.rs`
- `focus-tracker/src/App.tsx`
- `focus-tracker/README.md`
- `README.md`

## Verification Commands And Results

- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `16 passed`
- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo check`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain && pnpm build`
  - Passed

## Remaining Risks / Follow-up

- 本地 overlay 的 `workHours` 仍然用 collector 侧启发式任务组判断，不等同于服务端 AI 分类。
- 桌面 timeline 对本地未上传部分仍是近似 display block，不是完整服务端聚合。
- 还没有把 anchored menubar positioning、retry/backoff UI 和完整设备 onboarding 做完。
