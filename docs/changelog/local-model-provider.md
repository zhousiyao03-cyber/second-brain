# 2026-03-22 - Local Model Provider

Task / goal:
- 将项目默认 AI 运行方式切到本地 OpenAI-compatible 模型服务，避免继续依赖 OpenAI API 额度。

Key changes:
- 扩展 `src/server/ai/openai.ts`，支持两种模式：`AI_PROVIDER=local`（默认）和 `AI_PROVIDER=openai`（可选 fallback）。
- 本地模式通过 `createOpenAI({ baseURL, apiKey })` 连接任意 OpenAI-compatible 服务，默认读取 `AI_BASE_URL=http://127.0.0.1:11434/v1` 与 `AI_MODEL=qwen2.5:7b`。
- 保留 OpenAI 路径，便于后续需要时切回云端，但不再作为默认方案。
- 更新 Ask AI / AI 探索错误提示，使其更贴合“本地服务未启动”这类常见问题。
- 更新 `.env.example`、`README.md`、`PLAN.md`，明确本地模型是默认接法，并补充 Ollama / LM Studio 的示例配置。

Files touched:
- `.env.example`
- `README.md`
- `PLAN.md`
- `src/server/ai/openai.ts`
- `src/app/ask/page.tsx`
- `src/app/explore/page.tsx`
- `docs/changelog/local-model-provider.md`

Verification commands and results:
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm build` -> ✅ 通过。
- `curl -sS --max-time 2 http://127.0.0.1:11434/api/tags` -> ❌ 本机未启动 Ollama。
- `curl -sS --max-time 2 http://127.0.0.1:1234/v1/models` -> ❌ 本机未启动 LM Studio OpenAI-compatible 服务。
- `curl -sS --max-time 2 http://127.0.0.1:8000/v1/models` -> ❌ 本机未启动常见 vLLM OpenAI-compatible 服务。
- `PATH=/usr/local/bin:$PATH; set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module -e "...createOpenAI({ baseURL: process.env.AI_BASE_URL || 'http://127.0.0.1:11434/v1' ... })"` -> ❌ 已确认当前本地配置会尝试访问 `http://127.0.0.1:11434/v1` 的 `qwen2.5:7b`，但连接被拒绝（`ECONNREFUSED`）。

Remaining risks / follow-up:
- 当前机器上没有检测到本地模型服务，因此无法完成真实本地推理 smoke test。
- `qwen2.5:7b` 只是默认示例模型；如果你后续更看重中文质量或代码能力，可以直接改 `AI_MODEL` 到你本地已加载的模型 ID。
