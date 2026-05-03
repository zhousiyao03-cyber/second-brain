# Ask AI "Not Found" — Vercel AI SDK 错误端点修复 — 2026-05-03

## 问题
线上 Settings → AI Roles 配好 DeepSeek（chat / task / embedding 全部 `deepseek-v4-flash`），点 Ask AI 发 "hi"，前端显示红框 `Error: Not Found`，UI message stream 携带 `{"type":"error","errorText":"Not Found"}`。

## 根因
`@ai-sdk/openai` 的默认 model factory `sdk(modelId)` 走的是 OpenAI 新的 **Responses API**（`POST /v1/responses`），而 DeepSeek（以及其他 OpenAI-compatible 服务）只实现了老的 **Chat Completions API**（`POST /v1/chat/completions`），所以 DeepSeek 直接返回 HTTP 404。

knosi pod 日志确认：

```
url: 'https://api.deepseek.com/v1/responses',
model: 'deepseek-v4-flash',
statusCode: 404
```

`toUIMessageStreamResponse()` 默认会把上游异常的 message 压成简短文案，前端只看到 `"Not Found"`，没有 stack 也没有上游 url —— 之前定位用了好几轮才找到根因。

`[rag] query embedding failed — Not Found` 是另一回事：embedding role 也指向 DeepSeek，而 DeepSeek 公网根本没有 embedding 接口，那需要换 provider（OpenAI / 本地 transformers），不属于本次代码修复范围。

## 修复
`src/server/ai/provider/ai-sdk.ts`：
- 把三处 `sdk(provider.modelId)` 全部换成 `sdk.chat(provider.modelId)` —— 显式走 `/v1/chat/completions`，所有 OpenAI-compatible 服务（DeepSeek / Moonshot / SiliconFlow / Groq / OpenAI 自己）都支持
- `streamChatAiSdk` 的 `toUIMessageStreamResponse()` 加 `onError`：把上游 error.message 透出到前端，并在 server 打 `console.error("[ai-sdk stream error]", error)`，下次再出问题前端直接能看到真实原因

embedding 路径（`embeddings.ts`）用的是 `sdk.embeddingModel()` + `embedMany()`，本来就走 `/v1/embeddings`，端点是对的，没动。

## 文件
- `src/server/ai/provider/ai-sdk.ts`

## 验证
- `pnpm build` ✅
- `pnpm vitest run src/server/ai/provider/ai-sdk.test.ts` ✅ 2 passed（mock fetch 验证 chat 端点 + 模型 id 仍正确传递）
- 改动文件 `pnpm exec eslint` ✅ 零警告零错误
- 全仓 `pnpm lint` 大量噪音来自 `.next-e2e` 缓存（已记录在 `feedback_lint_e2e_cache.md`），与本次改动无关
- 部署后用户在线上点 Ask AI 验证（待用户确认）

## 剩余风险 / 后续
- DeepSeek embedding 调用仍会 404，因为 DeepSeek 没有 embedding API。embedding role 必须换 provider —— 在 UI 上提示用户配 OpenAI 或本地 transformers 才完整。
- 没改 model 校验：UI 仍允许填任意 model id 保存，跑到上游才知道对不对。可以考虑在 RoleRow 的 Save 之前调一次 `/v1/models` 校验是否在列表里（次要优化，不阻塞本修复）。
