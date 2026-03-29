# 2026-03-29 Dev Port Unification

## Task / Goal

把 Focus Tracker 的本地测试链路统一到单一开发端口，避免 Web 端、collector 和手动测试环境分别跑在 `3000` / `3200` 上，导致“页面是空的但 collector 有数据”这种假问题。

## Key Changes

- 将仓库根 `pnpm dev` 改为默认启动在 `3200` 端口。
- 将 `src/components/providers.tsx` 的本地 URL fallback 从 `3000` 改为 `3200`。
- 将桌面端和 Node collector 的默认 `base_url` 全部统一为 `http://127.0.0.1:3200`。
- 更新 README 中当前有效的本地开发入口和示例命令。
- 停掉旧的 `3000` dev server，并按新脚本重新启动 `3200`。

## Files Touched

- `package.json`
- `src/components/providers.tsx`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src-tauri/src/state.rs`
- `tools/focus-collector/collector.mjs`
- `README.md`

## Verification Commands And Results

- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `18 passed`
- `cd /Users/bytedance/second-brain && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain && pnpm dev`
  - Passed, Next dev started on `http://localhost:3200`
- `curl -I http://127.0.0.1:3200/`
  - Passed, server responded `307` to `/login`
- `curl -I http://127.0.0.1:3200/focus`
  - Passed, server responded `307` to `/login`

## Remaining Risks / Follow-up

- 当前 `3200` 环境仍然走正常登录流程，没有再启用手动测试用的 `AUTH_BYPASS`。
- collector 的本地 settings 已经是 `3200`，但如果以后有人改过本地 JSON 设置，仍可能手工指到别的地址。
