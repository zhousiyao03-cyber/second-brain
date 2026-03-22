# 2026-03-22 - OpenClaw / Codex OAuth Provider

Task / goal:
- 按本机 `openclaw` 的配置方式接入 Codex OAuth，让项目默认复用 `openai-codex/gpt-5.4`，而不是继续走 `OPENAI_API_KEY`。

Key changes:
- 扩展 `src/server/ai/provider.ts`，把 AI provider 统一成三种模式：
  - `AI_PROVIDER=codex`：复用 OpenClaw 的 OAuth 登录态，读取 `~/.openclaw/openclaw.json` 与 `~/.openclaw/agents/main/agent/auth-profiles.json`
  - `AI_PROVIDER=openai`：保留标准 OpenAI API key 路线
  - `AI_PROVIDER=local`：保留本地 OpenAI-compatible 服务路线
- 新增 Codex OAuth 运行时逻辑：
  - 自动读取 OpenClaw 默认 profile / model
  - 通过仓库内自实现的 SSE transport 请求 `https://chatgpt.com/backend-api/codex/responses`
  - 使用 `@mariozechner/pi-ai/oauth` 刷新 token，并在刷新后回写同一个 auth profile，和 OpenClaw 共用登录态
- 重写 AI 路由的调用方式：
  - `/api/chat` 改为通过统一的 `streamChatResponse()` 输出文本流，在 Codex 模式下走仓库内的 Codex SSE 流式响应
  - `/api/explore`、`/api/summarize`、`/api/generate-lesson` 改为通过统一的 `generateStructuredData()` 生成结构化结果；Codex 模式下显式使用 JSON schema prompt + Zod 校验
- 更新 `.env.example`、`README.md`、`PLAN.md`，把默认接法改成 OpenClaw / Codex OAuth，并保留 OpenAI API / 本地模型作为可选模式。
- 将 AI provider 文件从 `src/server/ai/openai.ts` 重命名为 `src/server/ai/provider.ts`，避免开发态 Turbopack 持有旧模块图时继续报 `Can't resolve '@/server/ai/openai'`。
- 将本机 `.env.local` 的 `AI_PROVIDER` 从 `openai` 切到 `codex`（本地文件，未提交），让当前开发环境直接对齐 OpenClaw。
- 新增依赖 `@mariozechner/pi-ai` 以复用 OpenClaw 同款 Codex transport 与 OAuth 工具。

Files touched:
- `package.json`
- `pnpm-lock.yaml`
- `.env.example`
- `README.md`
- `PLAN.md`
- `src/server/ai/provider.ts`
- `src/app/api/chat/route.ts`
- `src/app/api/explore/route.ts`
- `src/app/api/summarize/route.ts`
- `src/app/api/generate-lesson/route.ts`
- `src/app/explore/page.tsx`
- `docs/changelog/codex-oauth-provider.md`
- `.env.local`（local only, not committed）

Verification commands and results:
- `PATH=/usr/local/bin:$PATH pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH pnpm build` -> ✅ 通过；Next.js 构建完成并产出 `/api/chat`、`/api/explore`、`/api/summarize`、`/api/generate-lesson` 路由。
- `set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module <<'EOF' ... completeSimple(getModel('openai-codex', 'gpt-5.4')) ... EOF` -> ✅ 返回 `stopReason: "stop"`，正文为 `连接成功`，确认 OpenClaw OAuth + Codex transport 可用。
- `set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module <<'EOF' ... routeModule.userland.POST(Request) for .next/server/app/api/chat/route.js ... EOF` -> ✅ 返回 `200`、`text/plain; charset=utf-8`，响应体为 `连接成功`。
- `set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module <<'EOF' ... routeModule.userland.POST() for .next/server/app/api/explore/route.js ... EOF` -> ✅ 返回 `200`、`application/json`，并生成 `interests + recommendations` 结构化 JSON。
- `PATH=/usr/local/bin:$PATH pnpm start --port 3001` -> ✅ 服务可正常启动，未再出现接入 `@mariozechner/pi-ai` 主包时那批动态 import 异常。
- `curl -sS -N --max-time 60 http://127.0.0.1:3001/api/chat ...` -> ✅ 返回 `连接成功`。
- `curl -sS --max-time 60 -X POST http://127.0.0.1:3001/api/explore` -> ✅ 返回 `200` JSON，包含 `interests` 与 `recommendations`。

Remaining risks / follow-up:
- Codex 结构化输出目前是“JSON schema prompt + Zod 校验”方案，不是 OpenAI 平台原生 `response_format`；日常功能已经可用，但如果后续要更强的结构化稳定性，可以再评估 tool calling / 原生 structured output 的进一步封装。
- 现在仓库内 Codex transport 固定为 SSE，以换取 Next.js 服务端稳定性；它和 OpenClaw 在认证、模型和后端地址上保持一致，但不复用 OpenClaw 的 `auto` WebSocket/SSE 策略。
