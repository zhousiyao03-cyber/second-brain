# 2026-03-29 Focus Desktop Production Default URL

## Task / Goal

修正桌面端默认仍指向本地 `3200` 的问题，让生产路径默认打开和配对线上 Focus 页面。

## Key Changes

- 桌面端前端默认 `Base URL` 改为线上域名
- Rust collector 默认配置也改为线上域名
- 对应单测期望同步更新

## Files Touched

- `focus-tracker/src/App.tsx`
- `focus-tracker/src-tauri/src/state.rs`
- `docs/changelog/2026-03-29-focus-desktop-production-default-url.md`

## Verification Commands And Results

- `cd focus-tracker && pnpm build`
  - passed
- `cd focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - passed

## Remaining Risks / Follow-up

- 本地开发如果仍需连 `localhost:3200`，需要显式设置 `FOCUS_COLLECTOR_BASE_URL`。
- 已安装/已运行过的本地实例如果保存了旧配置，还需要本地配置迁移或覆盖。
