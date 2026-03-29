# 2026-03-29 Focus Tracker hardening

## task / goal

- 收掉 Focus Tracker 剩余的 3 个明显缺口：
  - `/focus` 缺少分类 / summary 刷新交互
  - 桌面端仍依赖固定全局 bearer token
  - Tauri 面板还不够接近 menubar 行为
- 把功能推进到“可交给用户做一次性完整验证”的状态。

## key changes

- 新增 `focus_devices` 数据表，并生成 migration：
  - 支持 per-user, per-device token
  - 记录 `device_id`、`name`、`token_hash`、`token_preview`、`last_seen_at`、`revoked_at`
- 新增 `src/server/focus/device-auth.ts`：
  - 负责生成 desktop token
  - 负责 hash / preview
  - 抽出 ingest user 解析逻辑，支持：
    - 现有全局 ingest key
    - per-device token
    - session auth fallback
- 修改 `src/app/api/focus/ingest/route.ts`：
  - 使用新的 device auth helper
  - bearer token 现在可绑定到 `device_id`
  - 成功上传后会刷新 `focus_devices.last_seen_at`
- 扩展 `src/server/routers/focus.ts`：
  - `listDevices`
  - `registerDevice`
  - `revokeDevice`
  - `summaryStatus`
- 扩展 `src/server/ai/focus.ts`：
  - 为 session classification 和 daily summary 增加 deterministic fallback
  - 在没有可用 AI provider 时，`/focus` 仍然能正常生成可读结果
- 修改 `src/components/focus/focus-page-client.tsx`：
  - 增加 “Classify sessions”
  - 增加 “Refresh insights”
  - 展示 daily summary card
  - 增加 “Desktop access” 区块
  - 支持生成、复制、撤销 per-device token
- 修改 `focus-tracker/src-tauri/src/lib.rs` 与 `focus-tracker/src-tauri/tauri.conf.json`：
  - 失焦自动隐藏
  - `skipTaskbar: true`
  - 行为更接近 menubar panel
- 修改 `focus-tracker/src/App.tsx`：
  - 把输入语义从泛泛的 API key 调整为 device token
  - 提示 token 应从 `/focus` 的 Desktop access 区块生成
- 更新 E2E：
  - `e2e/focus-tracker.spec.ts` 现在还会验证：
    - `/focus` insights 刷新
    - desktop token 生成
- 更新 `README.md` 与 `focus-tracker/README.md`

## files touched

- `src/server/db/schema.ts`
- `drizzle/0005_small_clea.sql`
- `drizzle/meta/0005_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/server/focus/device-auth.ts`
- `src/server/focus/device-auth.test.mjs`
- `src/app/api/focus/ingest/route.ts`
- `src/server/routers/focus.ts`
- `src/server/ai/focus.ts`
- `src/components/focus/focus-page-client.tsx`
- `e2e/focus-tracker.spec.ts`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/tauri.conf.json`
- `focus-tracker/src/App.tsx`
- `README.md`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-tracker-hardening.md`

## verification commands and results

- `node --test --experimental-strip-types src/server/focus/device-auth.test.mjs`
  - ✅ 4 passed
- `pnpm lint src/app/'(app)'/focus/page.tsx src/app/'(app)'/page.tsx src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/server/routers/focus.ts src/server/ai/focus.ts src/app/api/focus/ingest/route.ts e2e/focus-tracker.spec.ts focus-tracker/src/App.tsx focus-tracker/vite.config.ts`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - ✅ 1 passed
- `pnpm db:generate`
  - ✅ 生成 `drizzle/0005_small_clea.sql`
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过
- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 6 passed
- `cd focus-tracker && pnpm build`
  - ✅ 通过
- `cd focus-tracker && pnpm tauri dev --no-watch`
  - ✅ Vite dev server 启动成功
  - ✅ Rust binary `target/debug/focus-tracker` 启动成功

## remaining risks or follow-up items

- 桌面端现在已经支持 per-device token，但仍然没有“登录桌面端后自动申请 token”的完整 device onboarding flow。
- `/focus` summary 已经有 AI + fallback 双路径，但 summary 目前仍是按单日即时生成，没有 background job / cache invalidation 策略。
- tray panel 已经更接近 menubar popover，但还没做到系统级 anchored positioning。
