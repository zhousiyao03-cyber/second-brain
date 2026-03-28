# 2026-03-28 auth-mobile 登出稳定性修复

## task / goal

- 修复 `e2e/auth-mobile.spec.ts` 在单独运行时的隔离失败。
- 让注册后立即点击“登出”也能稳定跳到 `/login`。

## key changes

- 新增 `src/app/(app)/actions.ts`，提供服务端 `logout` action。
- 将桌面侧栏和移动端菜单里的“登出”从 client `onClick` 改成 `<form action={logout}>`。
- 不再依赖客户端 hydration 后的 `signOut()` 点击处理，避免注册跳转回首页后立刻点击登出时偶发无效。

## files touched

- `src/app/(app)/actions.ts`
- `src/components/layout/sidebar.tsx`
- `src/components/layout/mobile-nav.tsx`
- `docs/changelog/auth-mobile-logout-stability.md`

## verification commands and results

- `pnpm exec playwright test e2e/auth-mobile.spec.ts --config=playwright.auth.config.ts --grep "错误密码会显示表单错误"`
  - ✅ 1 passed
- `pnpm exec playwright test e2e/auth-mobile.spec.ts --config=playwright.auth.config.ts`
  - ✅ 3 passed
- `pnpm lint -- 'src/app/(app)/actions.ts' src/components/layout/sidebar.tsx src/components/layout/mobile-nav.tsx`
  - ✅ 通过
- `pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- auth Playwright `webServer` 里仍会出现 Node 自带的 `NO_COLOR` / `FORCE_COLOR` warning，但不影响功能和测试结果。
