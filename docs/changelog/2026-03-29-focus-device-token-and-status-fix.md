# 2026-03-29 Focus Device Token And Status Fix

## Task / Goal

修复桌面端与 `/focus` 数据明显对不上的链路问题，重点处理 device token 配置错误和 `/api/focus/status` 被登录中间件拦截的问题。

## Key Changes

- 在 `src/proxy.ts` 中放行 `/api/focus/status`，避免桌面端状态同步被重定向到 `/login`。
- 为当前桌面设备 `7e968b4b-d323-4e38-91ec-890c0436a1be` 写入一枚真实可用的 `focus_devices` token，并将本地 `focus-settings.json` 改为使用该真实 bearer token。
- 验证当前桌面端设备的 `/api/focus/status` 和 `/api/focus/ingest` 已可通过 bearer token 正常访问。
- 重启 Tauri 桌面端，使其加载新的 token 和状态同步能力。

## Files Touched

- `src/proxy.ts`
- `docs/changelog/2026-03-29-focus-device-token-and-status-fix.md`

## Verification Commands And Results

- `curl -sS 'http://127.0.0.1:3200/api/focus/status?deviceId=7e968b4b-d323-4e38-91ec-890c0436a1be&timeZone=Asia%2FSingapore&date=2026-03-29' -H 'Authorization: Bearer <new-device-token>'`
  - Passed, returned canonical focus status JSON with `workHoursSecs`, `focusedSecs`, `displaySessions`
- `curl -sS 'http://127.0.0.1:3200/api/focus/ingest' -H 'Content-Type: application/json' -H 'Authorization: Bearer <new-device-token>' --data '{...}'`
  - Passed, returned `{"acceptedCount":1,...}`
- `cd /Users/bytedance/second-brain/focus-tracker && PATH="/opt/homebrew/opt/rustup/bin:$PATH" pnpm tauri dev --no-watch`
  - Passed, `target/debug/focus-tracker` relaunched successfully

## Remaining Risks / Follow-up

- 当前 Web 的 `Desktop access` 仍然使用 browser-local 生成的 `deviceId`，并不等于真实 Tauri `device_id`，这会让“Generate desktop token”流程在产品上继续误导用户。
- 这次为了先把单机测试链路跑通，手工给当前桌面设备补了一枚可用 token；后续应改成真正的配对 / 绑定流程。
