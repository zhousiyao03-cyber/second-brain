# 2026-03-28 账号设置与移动端菜单验证

## task / goal

- 为当前项目补齐账号信息 / 密码修改支持。
- 确认移动端菜单在真实浏览器里仍然可打开并完成页面跳转。

## key changes

- 新增 `/settings` 页面，提供两块能力：
  - 修改昵称和邮箱。
  - 修改本地密码；如果账号还没有本地密码，则允许直接设置。
- 新增 `src/app/(app)/settings/actions.ts`，在 Server Action 里做：
  - 登录态校验
  - 邮箱去重
  - 凭证邮箱同步
  - 当前密码校验
  - 新密码哈希写入
- 在桌面侧栏和移动端菜单底部新增“账号设置”入口。
- 新增 `e2e/account-settings.spec.ts`，固化“改昵称/邮箱”和“改密码”的期望行为。
- 恢复了 SQLite 路径 helper，并让运行时 / Drizzle CLI / auth Playwright setup 都能复用同一套数据库路径解析。
- 修正 `src/server/auth/password.ts` 的 `scrypt` Promise 包装，解决当前 Next 16 / TS 构建下的类型错误。
- 移除 `src/lib/auth.ts` 中当前类型定义已经不接受的 `experimental.accountLinking` 配置，恢复生产构建通过。

## files touched

- `README.md`
- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/settings/actions.ts`
- `src/components/layout/sidebar.tsx`
- `src/components/layout/mobile-nav.tsx`
- `src/server/db/path.ts`
- `src/server/db/index.ts`
- `drizzle.config.ts`
- `src/server/auth/password.ts`
- `src/lib/auth.ts`
- `e2e/account-settings.spec.ts`
- `e2e/auth-test-db.ts`
- `playwright.auth.config.ts`
- `docs/changelog/account-settings-and-mobile-nav.md`

## verification commands and results

- `pnpm lint`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过
  - ⚠️ 仍有 `better-sqlite3` 的 module-not-found warning，但构建最终成功
- `pnpm exec playwright test e2e/auth-mobile.spec.ts e2e/account-settings.spec.ts --config=playwright.auth.config.ts`
  - ✅ 5 passed
- `node -e '<Playwright profile flow script against http://localhost:3303>'`
  - ✅ 完成注册 -> `/settings` 修改昵称/邮箱 -> 登出 -> 用新邮箱重新登录
- `node -e '<Playwright password flow script against http://localhost:3303>'`
  - ✅ 完成注册 -> `/settings` 修改密码 -> 旧密码登录失败 -> 新密码登录成功
- `node -e '<Playwright mobile-nav flow script against http://localhost:3303>'`
  - ✅ 390x844 视口下打开菜单并跳转到 `/notes`
- `pnpm exec playwright test e2e/auth-mobile.spec.ts --config=playwright.auth.config.ts`
  - ✅ 3 passed
- `pnpm exec playwright test e2e/account-settings.spec.ts --config=playwright.auth.config.ts`
  - ✅ 2 passed

## remaining risks or follow-up items

- `better-sqlite3` 仍未安装，`token-usage-local` 在开发 / 构建阶段会给出 warning；虽然不会阻塞这次功能，但最好后续单独清理。
