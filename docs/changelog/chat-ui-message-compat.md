# 2026-03-22 - Chat UI Message Compatibility

Task / goal:
- 修复 `/api/chat` 无法处理 AI SDK `useChat` / `TextStreamChatTransport` 请求格式，导致 Ask AI 提交后接口 `200` 但没有响应体的问题。

Key changes:
- 在 `src/app/api/chat/route.ts` 中新增消息归一化逻辑，兼容两类输入：
  - AI SDK 前端发送的 UI messages（`role + parts`）
  - 旧的 model messages（`role + content`）
- 在进入 `streamText` 之前先完成消息格式转换，避免格式错误被延后到流响应阶段，造成空 `200 OK`。
- 对真正的输入格式错误返回 `400` JSON，而不是静默返回空流。
- 更新 `e2e/phase4.spec.ts`，用和真实前端一致的 UI message payload 覆盖 `/api/chat`，并断言响应体非空，防止回归。

Files touched:
- `src/app/api/chat/route.ts`
- `e2e/phase4.spec.ts`
- `docs/changelog/chat-ui-message-compat.md`

Verification commands and results:
- `curl 'http://localhost:3000/api/chat' ... --data-raw '{"id":"ogix6nE9Ty6TFrpc","messages":[{"parts":[{"type":"text","text":"你好"}],"id":"1nGauJ0NVBwAWDLO","role":"user"}],"trigger":"submit-message"}' -i` -> 修复前 ✅ 复现问题：`HTTP/1.1 200 OK`，但响应体为空。
- `curl 'http://localhost:3000/api/chat' ... --data-raw '{"id":"ogix6nE9Ty6TFrpc","messages":[{"parts":[{"type":"text","text":"你好"}],"id":"1nGauJ0NVBwAWDLO","role":"user"}],"trigger":"submit-message"}' -i` -> 修复后 ✅ 返回 `HTTP/1.1 200 OK`，且响应体为 `你好！有什么可以帮助你的吗？`。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm build` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm exec playwright test e2e/phase4.spec.ts --reporter=line` -> ✅ `8 passed`。

Remaining risks / follow-up:
- 当前 Ask AI 仍使用纯文本流返回；如果后续要在聊天中显示 reasoning、工具调用或结构化片段，可以再考虑切到 UI message stream 响应格式。
