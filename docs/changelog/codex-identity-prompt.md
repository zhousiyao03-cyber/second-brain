# 2026-03-22 - Codex Identity Prompt

Task / goal:
- 修正 Ask AI 的身份提示，让 `codex` 模式下的回答在用户询问身份或模型时能明确说明自己运行在 OpenAI Codex 上，而不是继续使用过于泛化的“AI 助手”口径。

Key changes:
- 在 `src/server/ai/provider.ts` 中新增 `getChatAssistantIdentity()`，根据当前 provider 动态生成身份文案：
  - `codex` 模式下说明当前运行在 `OpenAI Codex` 与实际 chat model 上
  - `openai` / `local` 模式下也会按当前运行方式返回对应身份说明，避免说错
- 更新 `src/app/api/chat/route.ts` 的系统提示构建逻辑，在 direct / 无检索结果 / 有检索结果三种分支里统一注入动态身份文案。

Files touched:
- `src/server/ai/provider.ts`
- `src/app/api/chat/route.ts`
- `docs/changelog/codex-identity-prompt.md`

Verification commands and results:
- `PATH=/usr/local/bin:$PATH pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH pnpm build` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH pnpm start --port 3004` -> ✅ 服务可正常启动。
- `curl -sS -N --max-time 60 http://127.0.0.1:3004/api/chat ... "你是谁？你现在用的是什么模型？"` -> ✅ 返回 `我是你的 AI 助手。当前运行在 OpenAI Codex，使用的是 gpt-5.4 模型。`

Remaining risks / follow-up:
- 这次调整只影响系统提示，不会强制每轮都主动提 Codex；只有用户问到身份、模型或运行方式时，模型才更容易明确说出来。
