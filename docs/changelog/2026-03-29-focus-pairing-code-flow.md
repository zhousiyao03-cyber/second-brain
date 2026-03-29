# 2026-03-29 Focus Pairing Code Flow

## Task / Goal

把 Focus Tracker 的桌面端接入流程从“手动复制 device ID 和 token”改成“Web 生成一次性 pairing code，桌面端输入 code 后自动换正式 device token”的可上线形态。

## Key Changes

- `src/server/db/schema.ts`
  - 新增 `focus_device_pairings` 表，保存短时一次性 pairing code 的 hash、过期时间和消费结果
- `src/server/focus/pairing.ts`
  - 新增 pairing code helper，包含 code 生成、hash、TTL 和过期判断
- `src/server/routers/focus.ts`
  - 新增 `createPairingCode` mutation
  - 生成新 code 前会使同用户之前尚未消费的 active code 失效
- `src/app/api/focus/pair/route.ts`
  - 新增公共配对路由
  - 桌面端提交 `code + real deviceId + deviceName` 后，服务端完成一次性消费并签发正式 device token
- `src/proxy.ts`
  - 放行 `/api/focus/pair`
- `src/components/focus/focus-page-client.tsx`
  - `Desktop access` 改成生成 pairing code，不再展示手动 deviceId / token 配置流
- `focus-tracker/src/App.tsx`
  - setup 区改成输入 pairing code
  - collector 自动用 pairing code 交换正式 device token 并本地保存
- `focus-tracker/src-tauri/src/pairing.rs`
  - 新增桌面端配对请求实现
- `e2e/focus-tracker.spec.ts`
  - 回归测试改成验证 `Generate pairing code`
- 清理本地测试库里之前由旧 bug 或 smoke test 产生的临时设备记录，避免污染手测

## Files Touched

- `src/server/db/schema.ts`
- `src/server/focus/pairing.ts`
- `src/server/focus/pairing.test.mjs`
- `src/server/routers/focus.ts`
- `src/app/api/focus/pair/route.ts`
- `src/proxy.ts`
- `src/components/focus/focus-page-client.tsx`
- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`
- `focus-tracker/src-tauri/src/lib.rs`
- `focus-tracker/src-tauri/src/pairing.rs`
- `e2e/focus-tracker.spec.ts`
- `playwright.config.ts`
- `README.md`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-pairing-code-flow.md`

## Verification Commands And Results

- `node --test --experimental-strip-types src/server/focus/pairing.test.mjs src/server/focus/device-auth.test.mjs src/server/focus/aggregates.test.mjs`
  - Passed, `13 passed`
- `pnpm lint src/server/routers/focus.ts src/app/api/focus/pair/route.ts src/components/focus/focus-page-client.tsx src/proxy.ts e2e/focus-tracker.spec.ts`
  - Passed
- `pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker && pnpm build`
  - Passed
- `cd /Users/bytedance/second-brain/focus-tracker/src-tauri && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test`
  - Passed, `19 passed`
- `pnpm db:generate`
  - Passed, generated `drizzle/0006_high_callisto.sql`
- `pnpm db:push`
  - Passed
- `pnpm exec playwright test e2e/focus-tracker.spec.ts`
  - Passed, `1 passed (19.7s)`
- `curl -sS -X POST http://127.0.0.1:3200/api/focus/pair ...`
  - Passed, returned a fresh `fct_...` device token for the submitted pairing code

## Remaining Risks / Follow-up

- 目前 pairing code 依赖高熵随机值 + 5 分钟 TTL + 一次性消费，已经适合当前上线节奏，但还没有单独的请求限流。
- 设备 onboarding 仍然是“在 Web 点 Generate pairing code，再到桌面端输一次 code”，还不是二维码或深链级别的一步到位体验。
