# 2026-03-29 Focus Desktop Pairing Fix

## Task / Goal

修复 `/focus` 的 `Desktop access` 配对 bug，避免浏览器本地伪造 `deviceId` 并为不存在的桌面设备生成 token。

## Key Changes

- `src/components/focus/focus-page-client.tsx`
  - 删除 browser-local `deviceId` 生成逻辑
  - `Desktop access` 改成显式输入真实 `Desktop device ID`
  - 只有同时填写 `device name` 和 `deviceId` 时才允许生成 token
  - 新增说明文案，明确浏览器不会再自动生成设备 ID
- `focus-tracker/src/App.tsx`
  - 在桌面端 `Fix setup` 区块展示真实 `Device ID`
  - 新增 `Copy` 入口，便于把真实设备 ID 粘贴到 `/focus`
- `focus-tracker/src/App.css`
  - 补充只读输入行样式，适配新的 `Device ID + Copy` 布局
- `e2e/focus-tracker.spec.ts`
  - 回归测试改成“必须先填写 Desktop device ID，才能生成 token”
- `playwright.config.ts`
  - Playwright WebServer 改成 `pnpm exec next dev --port 3100`，避免被固定到 `3200` 的 `pnpm dev` 脚本覆盖
- 清理本地测试库里由旧 bug 生成的两条假设备记录，只保留真实桌面设备

## Files Touched

- `src/components/focus/focus-page-client.tsx`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `e2e/focus-tracker.spec.ts`
- `playwright.config.ts`
- `README.md`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-desktop-pairing-fix.md`

## Verification Commands And Results

- `pnpm lint src/components/focus/focus-page-client.tsx playwright.config.ts e2e/focus-tracker.spec.ts`
  - Passed
- `pnpm build`
  - Passed
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - Passed, `1 passed (19.7s)`
- `cd /Users/bytedance/second-brain/focus-tracker && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `18 passed`
- `sqlite3 data/second-brain.db "delete ...; select id, device_id, name, token_preview from focus_devices order by created_at desc;"`
  - Passed, current local test DB only keeps the real desktop device `7e968b4b-d323-4e38-91ec-890c0436a1be`

## Remaining Risks / Follow-up

- 当前配对仍然是“手动复制 device ID + 手动粘贴 token”，还不是完整 onboarding。
- 历史上如果其他环境已经生成过浏览器伪设备 token，需要按同样思路清理对应 `focus_devices` 记录。
