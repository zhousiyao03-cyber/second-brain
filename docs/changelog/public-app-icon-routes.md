# 2026-03-28 Public App Icon Routes

- date: 2026-03-28
- task / goal: 修复未登录或系统抓取站点图标时，`icon` / `apple-icon` / `manifest` 被鉴权中间件重定向到登录页，导致保存到苹果桌面后没有 logo 的问题。
- key changes:
  - 将 `/icon`、`/apple-icon`、`/manifest.webmanifest` 加入公开路径，避免被重定向到 `/login`。
  - 验证图标和 manifest 资源现在会直接返回图片/manifest，而不是登录页。
- files touched:
  - `src/proxy.ts`
  - `docs/changelog/public-app-icon-routes.md`
- verification commands and results:
  - `curl -I -s 'http://localhost:3000/icon?size=192'` -> passed，返回 `200 OK` 和 `content-type: image/png`
  - `curl -I -s 'http://localhost:3000/apple-icon'` -> passed，返回 `200 OK` 和 `content-type: image/png`
  - `curl -I -s 'http://localhost:3000/manifest.webmanifest'` -> passed，返回 `200 OK` 和 `content-type: application/manifest+json`
- remaining risks or follow-up items:
  - 当前 `/icon?size=192` 实际仍返回 `64x64` 图像，虽然不再丢 icon，但如果要进一步优化苹果桌面/PWA 图标清晰度，还需要补多尺寸 icon 产物。
