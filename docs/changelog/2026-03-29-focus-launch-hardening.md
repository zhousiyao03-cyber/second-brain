# 2026-03-29 Focus Launch Hardening

## Task / Goal

为 Focus Tracker 上线前补齐最后一轮产品化和安全边界：pairing 限流、Web 端设备状态 UI、桌面端 token 失效 / 限流恢复提示。

## Key Changes

- `src/server/db/schema.ts`
  - 新增 `focus_pairing_rate_limits` 表
- `src/server/focus/rate-limit-core.ts`
  - 新增纯函数窗口限流逻辑，便于单测
- `src/server/focus/rate-limit.ts`
  - 新增 DB-backed pairing 限流实现
  - 对限流 key 做 SHA-256 hash，不把原始 IP / 设备键明文落库
- `src/server/routers/focus.ts`
  - `createPairingCode` 现在按用户限流，超限返回 `TOO_MANY_REQUESTS`
- `src/app/api/focus/pair/route.ts`
  - 配对完成接口现在按 `IP + deviceId` 限流
  - 返回 `429` 时带 `retry-after`
- `src/components/focus/focus-page-client.tsx`
  - `Desktop access` 增加 pairing code 生成错误展示
  - 设备列表增加 `Connected / Recent device / Paired / Revoked`
  - 显示 `last seen` 风格的相对时间
- `focus-tracker/src-tauri/src/error_state.rs`
  - 新增桌面端错误归一化，把 `401/410/429` 转成明确的恢复指引
- `focus-tracker/src-tauri/src/lib.rs`
  - 上传、状态同步、配对都接入新的错误归一化
  - token 无效时自动清空本地 token，并清除旧 snapshot，强制进入重连态
- `focus-tracker/src/App.tsx`
  - 上传状态和 `Attention needed` 文案改成恢复导向，而不是直接暴露底层错误字符串

## Files Touched

- `src/server/db/schema.ts`
- `src/server/focus/rate-limit-core.ts`
- `src/server/focus/rate-limit.ts`
- `src/server/focus/rate-limit.test.mjs`
- `src/server/routers/focus.ts`
- `src/app/api/focus/pair/route.ts`
- `src/components/focus/focus-page-client.tsx`
- `focus-tracker/src-tauri/src/error_state.rs`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src/App.tsx`
- `README.md`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-launch-hardening.md`

## Verification Commands And Results

- `node --test --experimental-strip-types src/server/focus/rate-limit.test.mjs src/server/focus/pairing.test.mjs src/server/focus/device-auth.test.mjs src/server/focus/aggregates.test.mjs`
  - Passed, `15 passed`
- `pnpm lint src/server/focus/rate-limit-core.ts src/server/focus/rate-limit.ts src/server/routers/focus.ts src/app/api/focus/pair/route.ts src/components/focus/focus-page-client.tsx src/proxy.ts e2e/focus-tracker.spec.ts`
  - Passed
- `pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `21 passed`
- `pnpm db:generate`
  - Passed, generated `drizzle/0007_lyrical_shriek.sql`
- `pnpm db:push`
  - Passed
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - Passed, `1 passed (19.9s)`

## Remaining Risks / Follow-up

- 当前限流已经足够 MVP 上线，但还是应用层 / 数据库层限流，不是边缘层限流。
- 设备列表已经有状态语义，但还没有单独的设备详情页或 rename 能力。
- 真正发版前仍需要桌面端签名、安装包分发和升级策略。
