# 2026-03-28 清理 better-sqlite3 构建告警

## task / goal

- 去掉 `pnpm build` / auth Playwright `webServer` 里由 `better-sqlite3` 可选依赖触发的 `module-not-found warning`。

## key changes

- 调整 `src/server/token-usage-local.ts` 的 `better-sqlite3` 加载方式。
- 不再使用会被 Turbopack 静态解析到的 `require("better-sqlite3")`。
- 改为 runtime-only 的动态 require，并补上最小 SQLite 构造器 / statement 类型，保留“未安装时返回 `null`”的降级行为。

## files touched

- `src/server/token-usage-local.ts`
- `docs/changelog/clear-better-sqlite3-build-warning.md`

## verification commands and results

- `pnpm build`
  - ✅ 通过
  - ✅ `better-sqlite3` 的 `module-not-found warning` 已消失
- `pnpm lint -- src/server/token-usage-local.ts`
  - ✅ 通过
- `pnpm exec playwright test e2e/auth-mobile.spec.ts --config=playwright.auth.config.ts --grep "错误密码会显示表单错误"`
  - ⚠️ 未通过，失败点是既有断言 `登出后应跳到 /login`，实际落在 `/`
  - ✅ 但本次启动的 auth `webServer` 日志里已不再出现 `better-sqlite3` 的 `module-not-found warning`

## remaining risks or follow-up items

- 当前项目仍未安装 `better-sqlite3`；在未安装的环境中，本地 token usage 的 SQLite 读取能力会继续按设计降级为不可用状态，而不是报构建 warning。
- `e2e/auth-mobile.spec.ts` 的“错误密码”用例在单独运行时存在登出跳转断言问题，和这次 warning 清理无关，后续可单独排查。
