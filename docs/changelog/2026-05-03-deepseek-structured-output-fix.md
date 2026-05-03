# DeepSeek `response_format unavailable` — Drifter / Council 修复 — 2026-05-03

## 问题

线上 DeepSeek（`deepseek-v4-flash`，chat + task 都指向它）下：
- **Drifter**：发消息后，对话区出现 `· This response_format type is unavailable now`，Pip 不回话
- **Council**：`POST /api/council/[id]/chat` 返回 200 SSE，但前端只显示"暂时没人想接话了"，没有任何 agent 发言

## 根因

两条链路都走 `generateStructuredData → generateStructuredDataAiSdk`，内部用 Vercel AI SDK 的 `Output.object({ schema })`。AI SDK 看到 `Output.object` 就把 `responseFormat: { type: "json", schema }` 传给 `@ai-sdk/openai`，后者会拼成：

```json
{ "response_format": { "type": "json_schema", "json_schema": { ... } } }
```

DeepSeek 仅支持 `response_format: { type: "json_object" }`（无 schema 强约束），不支持 `json_schema`，所以服务端原样回 `"This response_format type is unavailable now."`。

错误透出方式不同造成两种症状：
- Drifter：`/api/drifter/chat` 的 catch 把 `getAIErrorMessage(err)` 直接放入 JSON body → 前端 `dialogue-box` 直接渲染那行字
- Council：每个 persona 在 `classifyShouldSpeak` 里都失败 → `catch` 返回 `shouldSpeak: false` → queue 空 → orchestrator 发 `stopped: consecutive_no` → 前端 fallback "暂时没人想接话了"

Ask AI 之前一次修复（`2026-05-03-ask-ai-deepseek-not-found-fix.md`）已经把它从 `Output.object` 改成纯 `streamText` + tools，所以畅通；Drifter / Council 还在老路上。

## 修复

`src/server/ai/provider/ai-sdk.ts`：

- 新增 `needsJsonObjectFallback(provider)` —— 通过 `baseURL` 主机名识别 DeepSeek（`*.deepseek.com`），后续若有同样限制的服务（Moonshot / Together 之类）只需在此补一行
- 新增 `generateStructuredDataJsonObject<TSchema>` —— DeepSeek 专用路径：
  - 用 `wrapLanguageModel` + `defaultSettingsMiddleware({ settings: { responseFormat: { type: "json" } } })` 强制底层发 `{ "response_format": { "type": "json_object" } }`（OpenAI provider 在 `responseFormat.type === "json"` 但**没传 schema** 时就走这个分支）
  - 把 zod schema 用 `z.toJSONSchema(schema, { target: "draft-7" })` 序列化，作为 prompt 后缀提供给模型（DeepSeek 的 json_object 模式不做 schema 校验，靠提示词）
  - 加 `extractJsonMiddleware()` 自动剥 ```json fences
  - 拿到 text 后 `JSON.parse` + `schema.parse` 做客户端校验
- `generateStructuredDataAiSdk` 入口分流：DeepSeek → 新路径，其它（OpenAI、本地 ollama 等）继续用原 `Output.object`

调用方（`drifter.ts`、`council/classifier.ts`）一行未动 —— provider 层屏蔽差异。

## 文件

- `src/server/ai/provider/ai-sdk.ts`
- `src/server/ai/provider/ai-sdk.test.ts` —— 新增 5 个测试覆盖 deepseek 路径

## 验证

- `pnpm vitest run src/server/ai/provider/ai-sdk.test.ts` ✅ 7 passed
  - mock fetch 验证 deepseek 调用真的发 `response_format: { type: "json_object" }`，**不**发 `json_schema`
  - 验证 OpenAI 调用仍走 `json_schema`（不影响其它 provider）
  - 验证返回文本被 zod schema 正确校验解析
  - 验证 ` ```json ` 包裹的回答能被 `extractJsonMiddleware` 剥掉
  - 验证非 JSON 回答会抛带描述的错误
- `pnpm vitest run` ✅ 232/233 passed（唯一失败 `safe-fetch.test.ts > rejects http://[::1]` 是本机 IPv6 DNS 行为，与本改动无关）
- `pnpm build` ✅
- `pnpm lint` ✅ 0 errors（warnings 全部是预先存在的）
- 线上验证：待用户在 https://www.knosi.xyz 重新打开 Drifter / Council 验证

## 剩余风险

- 没改任何调用方，drifter / council 的 prompt、schema 都没动 —— 兼容 deepseek 是纯 provider 层 transparent 转换
- DeepSeek 在 json_object 模式下若返回 invalid JSON，新路径会抛 `Provider returned non-JSON in json_object mode (...)`。Council classifier 的外层 catch 会接住把 persona 标记为 `shouldSpeak: false`；Drifter 的 catch 会回 500 `getAIErrorMessage`。后续若发现 deepseek 经常返回污染 JSON，可加一次 retry 或 `repairText`。
- `needsJsonObjectFallback` 只匹配了 `*.deepseek.com`。其他 OpenAI-compat 服务若同样不支持 `json_schema`，需在那个函数里补 host
