# 2026-03-28 iOS 主屏 Web App 登录态持久化修复

## task / goal

- 处理 iOS Safari “添加到主屏幕”后作为 Web App 使用时，关闭再打开经常需要重新登录的问题。
- 补齐站点的 PWA / iOS Web App 元信息，并把 Auth.js session 生命周期配置写显式。

## key changes

- 在 `src/app/manifest.ts` 新增 Web App Manifest，声明 `start_url`、`scope`、`display: "standalone"` 和图标。
- 在 `src/app/layout.tsx` 增加 `manifest`、`applicationName` 和 `appleWebApp` metadata，确保 iOS 主屏安装走明确的 Web App 配置。
- 在 `src/lib/auth.ts` 显式设置 JWT session 的 `maxAge` 和 `updateAge`，避免依赖默认值。
- 在 `README.md` 增加 iPhone 主屏安装的使用说明，提醒删除旧图标后重新安装并重新登录一次。

## files touched

- `src/app/manifest.ts`
- `src/app/layout.tsx`
- `src/lib/auth.ts`
- `README.md`
- `docs/changelog/auth-ios-home-screen-session.md`

## verification commands and results

- `pnpm lint -- src/app/layout.tsx src/app/manifest.ts src/lib/auth.ts`
  - ✅ 通过
- `pnpm exec playwright test e2e/auth-mobile.spec.ts --config=playwright.auth.config.ts`
  - ✅ 3 passed
- `pnpm build`
  - ✅ 通过，构建产物包含 `/manifest.webmanifest`

## remaining risks or follow-up items

- iOS 主屏 Web App 和 Safari 标签页本身就是独立数据容器，旧主屏图标不会自动继承新 metadata；需要用户删除旧图标后重新添加。
- 这次变更能提高“安装为主屏 Web App”后的会话稳定性，但无法绕过 iOS 对独立 Web App 存储的系统级清理策略。
