# 2026-03-22 - Ollama Runtime Setup

Task / goal:
- 在本机安装 Ollama，拉取一个适合当前项目的本地模型，并把项目本地默认模型切到已验证可用的版本。

Key changes:
- 通过官方发布包安装了 `Ollama.app` 到 `/Applications/Ollama.app`，并创建了 `/opt/homebrew/bin/ollama` 命令行入口。
- 启动了本地 Ollama 服务，确认 `http://127.0.0.1:11434` 可访问。
- 拉取了 `qwen3:14b` 作为首轮候选模型，并验证到它在 Ollama OpenAI-compatible 接口里会优先输出 `reasoning` 字段，不适合作为当前应用默认模型。
- 追加拉取 `qwen2.5:14b` 作为项目默认本地模型，并将 `src/server/ai/openai.ts`、`.env.example`、`README.md`、`.env.local` 的本地默认模型同步到 `qwen2.5:14b`。
- 完成了命令行、本地 OpenAI-compatible HTTP 接口、以及 AI SDK 调用三层 smoke test，确认 `qwen2.5:14b` 能以当前项目配置稳定返回正常正文。

Files touched:
- `.env.example`
- `.env.local`
- `README.md`
- `src/server/ai/openai.ts`
- `docs/changelog/ollama-runtime-setup.md`

Verification commands and results:
- `open /Applications/Ollama.app && sleep 2 && lsof -iTCP:11434 -sTCP:LISTEN` -> ✅ Ollama 本地服务已监听 `localhost:11434`。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama list` -> ✅ 已检测到 `qwen2.5:14b` 与 `qwen3:14b`。
- `curl -sS --max-time 5 http://127.0.0.1:11434/api/tags` -> ✅ 本地模型服务可访问，并返回已安装模型列表。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama run qwen3:14b "Reply with exactly LOCAL_OK."` -> ✅ 模型可完成本地推理，但默认会进入 reasoning / thinking 风格输出。
- `curl -sS --max-time 30 http://127.0.0.1:11434/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"qwen3:14b","messages":[{"role":"user","content":"Reply with exactly LOCAL_API_OK."}],"max_tokens":16,"temperature":0}'` -> ✅ OpenAI-compatible 接口可用，但返回为 `message.content=""` + `message.reasoning=...`，不适合作为当前产品默认模型。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama pull qwen2.5:14b` -> ✅ 拉取完成，最终输出 `success`。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama run qwen2.5:14b "Reply with exactly LOCAL_OK."` -> ✅ 返回 `LOCAL_OK`。
- `curl -sS --max-time 30 http://127.0.0.1:11434/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"qwen2.5:14b","messages":[{"role":"user","content":"Reply with exactly LOCAL_API_OK."}],"max_tokens":16,"temperature":0}'` -> ✅ 返回 `message.content="LOCAL_API_OK"`。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module -e "... generateText({ model: provider(modelId) ... })"` -> ✅ 在 `.env.local` 当前配置下命中 `http://127.0.0.1:11434/v1` 的 `qwen2.5:14b`，并返回 `LOCAL_SDK_OK`。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm build` -> ✅ 通过。

Remaining risks / follow-up:
- 当前机器会同时保留 `qwen3:14b` 与 `qwen2.5:14b`，如果后续磁盘空间紧张，可以按需清理未使用模型。
