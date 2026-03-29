# 2026-03-29 Focus collector prototype

## task / goal

- 先打通 Focus Tracker 的桌面采集链路，不等 Rust / Tauri 环境齐备。
- 在仓库内提供一个可执行的 macOS collector 原型，验证“采样 -> sessionize -> ingestion API -> 数据库”流程。

## key changes

- 在 `src/app/api/focus/ingest/route.ts` 中新增 bearer token 认证入口：
  - 服务端配置 `FOCUS_INGEST_API_KEY`
  - 服务端配置 `FOCUS_INGEST_USER_ID`
  - 匹配后允许 collector 直接写入指定用户的数据
- 在 `src/proxy.ts` 中将 `/api/focus/ingest` 设为 public path，避免被全局登录重定向拦截。
- 新增 `tools/focus-collector/` 原型实现：
  - `macos-active-window.mjs`：通过 `osascript` 读取前台 app / window title 和 idle time
  - `sessionizer.mjs`：按 app + title 合并样本，切换窗口时关闭旧 session，空闲超时自动 flush
  - `outbox.mjs`：本地 JSON outbox 持久化
  - `collector.mjs`：批量上传、fixture 上传、dry-run、单次运行
  - `fixtures/demo-sessions.json`：固定 smoke test 输入
- 新增 `tools/focus-collector/sessionizer.test.mjs`，固化 session merge / window switch / idle flush 行为。
- 在 `package.json` 中新增 `pnpm focus:collector`。
- 更新 `.env.example`、`README.md`、`.gitignore`，补齐 collector 环境变量、运行方式和 outbox 忽略规则。

## files touched

- `.env.example`
- `.gitignore`
- `README.md`
- `package.json`
- `src/app/api/focus/ingest/route.ts`
- `src/proxy.ts`
- `tools/focus-collector/collector.mjs`
- `tools/focus-collector/macos-active-window.mjs`
- `tools/focus-collector/outbox.mjs`
- `tools/focus-collector/sessionizer.mjs`
- `tools/focus-collector/sessionizer.test.mjs`
- `tools/focus-collector/fixtures/demo-sessions.json`
- `docs/changelog/2026-03-29-focus-collector-prototype.md`

## verification commands and results

- `node --test tools/focus-collector/sessionizer.test.mjs`
  - ✅ 3 passed
- `node tools/focus-collector/collector.mjs --fixture tools/focus-collector/fixtures/demo-sessions.json --dry-run`
  - ✅ 打印待上传 payload
- `pnpm lint tools/focus-collector/collector.mjs tools/focus-collector/sessionizer.mjs tools/focus-collector/outbox.mjs tools/focus-collector/macos-active-window.mjs src/app/api/focus/ingest/route.ts`
  - ✅ 通过
- `SQLITE_DB_PATH=data/tmp/focus-collector-smoke.db TURSO_DATABASE_URL=file:data/tmp/focus-collector-smoke.db pnpm db:push`
  - ✅ Changes applied
- `FOCUS_INGEST_API_KEY=focus-test-key FOCUS_INGEST_USER_ID=test-user SQLITE_DB_PATH=data/tmp/focus-collector-smoke.db TURSO_DATABASE_URL=file:data/tmp/focus-collector-smoke.db pnpm exec next dev --port 3200`
  - ✅ 本地 dev server 成功启动
- `node --input-type=module -e "... INSERT OR IGNORE INTO users ..."`
  - ✅ 向 smoke DB 注入 `test-user`
- `node --input-type=module -e "... fetch('http://127.0.0.1:3200/api/focus/ingest', ...) ..."`
  - ✅ 返回 `{"acceptedCount":1,"accepted":["debug-session"],"rejected":[],"timeZone":"Asia/Singapore"}`
- `FOCUS_COLLECTOR_BASE_URL=http://127.0.0.1:3200 FOCUS_COLLECTOR_API_KEY=focus-test-key FOCUS_COLLECTOR_OUTBOX_PATH=data/tmp/focus-collector-smoke-outbox.json node tools/focus-collector/collector.mjs --fixture tools/focus-collector/fixtures/demo-sessions.json`
  - ✅ 返回 `fixture upload result { uploaded: 2, rejected: [] }`
- `node --input-type=module -e "... select source_session_id, app_name, window_title, duration_secs from activity_sessions ..."`
  - ✅ smoke DB 内查到 3 条 session（1 条 debug + 2 条 fixture）

## remaining risks or follow-up items

- 这还是 Node collector prototype，不是最终 Tauri menubar app。
- bearer token 目前是个人部署友好的固定用户模型，不是完整的多用户设备配对方案。
- 还没有 collector UI、后台常驻进程管理和真实 Tauri packaging。
