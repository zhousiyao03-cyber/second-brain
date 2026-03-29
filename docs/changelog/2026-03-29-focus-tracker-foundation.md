# 2026-03-29 Focus Tracker foundation

## task / goal

- 把 Focus Tracker 从“共享 SQLite”原型方案改成可上线的 Turso 架构。
- 落地 Web foundation：schema、ingestion API、按区间统计 helper、focus router。

## key changes

- 重写 Focus Tracker 设计稿与实施计划，正式切换为：
  - Tauri menubar 负责采集和批量上传。
  - Second Brain Web app 负责鉴权、入库、AI 分类和统计。
  - Turso / LibSQL 作为 canonical store。
- 在 `src/server/db/schema.ts` 中新增：
  - `activity_sessions`
  - `focus_daily_summaries`
  - 幂等用 `(user_id, source_device_id, source_session_id)` 唯一索引
- 新增 `src/server/focus/aggregates.ts`，实现：
  - 本地日边界解析
  - 跨午夜 session 按日切片
  - `dailyStats` / `weeklyStats` 聚合
  - `longestStreakSecs` 与 `appSwitches` 计算
- 新增 `src/app/api/focus/ingest/route.ts`：
  - 鉴权
  - payload 校验
  - 按 source idempotency upsert focus sessions
- 新增 `src/server/ai/focus.ts`，封装 session 分类与 daily summary 生成逻辑。
- 新增 `src/server/routers/focus.ts` 并注册到 tRPC 根 router，提供：
  - `dailySessions`
  - `dailyStats`
  - `weeklyStats`
  - `classifySessions`
  - `generateSummary`
  - `getDailySummary`
- 更新 `README.md`，标记 Focus Tracker 已进入服务端基础设施阶段。

## files touched

- `README.md`
- `docs/superpowers/specs/2026-03-29-focus-tracker-design.md`
- `docs/superpowers/plans/2026-03-29-focus-tracker.md`
- `docs/changelog/2026-03-29-focus-tracker-foundation.md`
- `src/server/db/schema.ts`
- `src/server/focus/aggregates.ts`
- `src/server/focus/aggregates.test.mjs`
- `src/server/ai/focus.ts`
- `src/server/routers/focus.ts`
- `src/server/routers/_app.ts`
- `src/app/api/focus/ingest/route.ts`
- `drizzle/0004_damp_makkari.sql`
- `drizzle/meta/0004_snapshot.json`
- `drizzle/meta/_journal.json`

## verification commands and results

- `node --test --experimental-strip-types src/server/focus/aggregates.test.mjs`
  - ✅ 3 passed
- `pnpm db:generate`
  - ✅ 成功生成 `drizzle/0004_damp_makkari.sql`
- `pnpm db:push`
  - ✅ Changes applied
- `pnpm lint src/server/focus/aggregates.ts src/server/routers/focus.ts src/app/api/focus/ingest/route.ts src/server/ai/focus.ts src/server/db/schema.ts src/server/routers/_app.ts`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- `/focus` 页面、dashboard focus card 和 Playwright 覆盖还没开始，这次只完成了 Web foundation。
- Tauri desktop collector 仍未实现，当前只有服务端接收与聚合能力。
- 目前 ingestion route 依赖常规登录态或 `AUTH_BYPASS`；桌面端的长期认证策略还需要在后续实现中定稿。
- `node --test --experimental-strip-types` 目前会打印 Node 实验特性 warning；如果后续持续扩大量级，最好补正式单测 runner。
