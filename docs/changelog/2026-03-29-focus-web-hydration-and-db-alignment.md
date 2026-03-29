# 2026-03-29 Focus Web Hydration And DB Alignment

## Task / Goal

修复 `/focus` 页面的 hydration mismatch，并把单一测试环境 `:3200` 对应的 `data/second-brain.db` 补到可用状态，避免页面虽然打开了但 focus 数据始终显示为 0。

## Key Changes

- 在 `src/components/focus/focus-page-client.tsx` 中，将 `deviceId` 的生成从 render 阶段改为 `useEffect` 挂载后生成，消除服务端和客户端渲染不一致导致的 hydration error。
- 对当前唯一测试库 `data/second-brain.db` 运行 schema push，补齐 `focus_devices` 等缺失表。
- 确认当前测试用户 `2a4a3c34-5127-4161-9887-c0e333550394` 在 `data/second-brain.db` 中已有 `157` 条 `activity_sessions`，并且 `focus_devices` 已存在。

## Files Touched

- `src/components/focus/focus-page-client.tsx`
- `docs/changelog/2026-03-29-focus-web-hydration-and-db-alignment.md`

## Verification Commands And Results

- `cd /Users/bytedance/second-brain && pnpm db:push`
  - Passed, schema changes applied
- `sqlite3 data/second-brain.db "select count(*) from focus_devices; select count(*) from activity_sessions where user_id = '2a4a3c34-5127-4161-9887-c0e333550394';"`
  - Returned `1` and `157`
- `cd /Users/bytedance/second-brain && pnpm build`
  - Passed

## Remaining Risks / Follow-up

- 当前页面是否立即从浏览器缓存中刷新出来，还取决于你本地浏览器是否用了旧的 hydration 错误页；必要时需要手动 hard refresh。
- 这套 `3200` 环境仍然走正常登录态，不是 `AUTH_BYPASS` 测试模式。
