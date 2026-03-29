# 2026-03-29 Focus Tracker web UI

## task / goal

- 把 Focus Tracker 从“服务端与桌面端基础设施已通”推进到用户可测试状态。
- 至少做到：dashboard 有 focus card、`/focus` 页面可用、桌面上传数据能直接在 Web UI 里看到。

## key changes

- 新增 `src/components/focus/focus-shared.tsx`：
  - 统一 focus duration、local date、top apps、timeline 的展示逻辑
  - 支撑 dashboard card 和 `/focus` 页面复用同一套时间轴渲染
- 新增 `src/components/focus/focus-page-client.tsx` 与 `src/app/(app)/focus/page.tsx`：
  - 增加 `/focus` 页面
  - 展示 selected day total focus、goal progress、longest streak、session count、app switches
  - 展示 true time-of-day timeline、top apps、weekly bars、session list
- 修改 `src/app/(app)/page.tsx`：
  - 在 dashboard hero 下增加 Focus card
  - 卡片展示 today total、goal progress、mini timeline、top apps
  - 卡片点击后可直接跳转 `/focus`
- 修改 `src/components/layout/navigation.ts`：
  - 在全局导航增加 `Focus` 入口
- 新增 `e2e/focus-tracker.spec.ts`：
  - 用真实 `/api/focus/ingest` 上传数据
  - 验证 dashboard focus card 和 `/focus` 页面
  - 验证重复上传不会让 `/focus` session 数翻倍
- 修复 `focus-tracker/vite.config.ts` 中失效的 `@ts-expect-error`，恢复仓库级 `pnpm build`
- 更新 `README.md`，把 Focus Tracker 状态从“基础设施进行中”更新为“主路径已可测试”

## files touched

- `src/app/(app)/page.tsx`
- `src/app/(app)/focus/page.tsx`
- `src/components/focus/focus-page-client.tsx`
- `src/components/focus/focus-shared.tsx`
- `src/components/layout/navigation.ts`
- `e2e/focus-tracker.spec.ts`
- `focus-tracker/vite.config.ts`
- `README.md`
- `docs/changelog/2026-03-29-focus-tracker-web-ui.md`

## verification commands and results

- `pnpm lint src/app/'(app)'/page.tsx src/app/'(app)'/focus/page.tsx src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/components/layout/navigation.ts e2e/focus-tracker.spec.ts`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - ✅ 1 passed
- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 6 passed
- `cd focus-tracker && pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- `/focus` 页面当前还没接 AI summary / 分类刷新按钮，先保证 deterministic 的可视化主路径可用。
- dashboard focus card 和 `/focus` 页面都依赖浏览器当前 timezone；如果后续要做历史回溯或多端统一，还需要补更明确的 timezone UX。
- Tauri 端虽然已经可上传并打开 `/focus`，但仍缺设备注册、token 轮换和更完整的上传重试策略。
