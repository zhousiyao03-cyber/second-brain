# 2026-03-22 - OpenAI Provider Migration

Task / goal:
- 将项目现有的 Anthropic/Claude 接入迁移到 OpenAI，并让开发者只需要配置 `OPENAI_API_KEY` 就能启用现有 AI 功能。

Key changes:
- 新增 `src/server/ai/openai.ts`，统一处理 `OPENAI_API_KEY`、默认模型和按场景覆盖模型的解析。
- 将 `/api/chat`、`/api/summarize`、`/api/explore`、`/api/generate-lesson` 从 `@ai-sdk/anthropic` 切换到 `@ai-sdk/openai`。
- 将摘要、探索、课程生成三个 JSON 输出接口改为 AI SDK v6 的 `Output.object(...)` 结构化输出，移除正则提取 JSON 的脆弱逻辑。
- 更新 Ask AI / AI 探索页的错误提示，改为指向 `OPENAI_API_KEY` 和模型配置。
- 新增根目录 `.env.example`，并同步更新 `README.md`、`PLAN.md` 中的当前 AI provider 和环境变量说明。

Files touched:
- `.env.example`
- `README.md`
- `PLAN.md`
- `package.json`
- `pnpm-lock.yaml`
- `src/server/ai/openai.ts`
- `src/app/api/chat/route.ts`
- `src/app/api/summarize/route.ts`
- `src/app/api/explore/route.ts`
- `src/app/api/generate-lesson/route.ts`
- `src/app/ask/page.tsx`
- `src/app/explore/page.tsx`

Verification commands and results:
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm rebuild better-sqlite3` -> ✅ 重新编译本地原生模块，修复 Node ABI 不匹配。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm build` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm exec playwright test e2e/phase4.spec.ts e2e/phase5.spec.ts e2e/v1-core-paths.spec.ts --reporter=line` -> ✅ 18 passed, 10 skipped。

Remaining risks / follow-up:
- 默认模型当前设为 `gpt-5.4`；如果账号权限、速率限制或成本策略不同，可能需要通过 `OPENAI_MODEL` / `OPENAI_CHAT_MODEL` / `OPENAI_TASK_MODEL` 覆盖到更便宜的型号。
- Ask AI 的引用来源标记仍依赖模型遵循隐藏注释格式，前端已有容错，但极端情况下仍可能不返回来源区。

---

## 2026-03-22 - Default Model Raised To GPT-5.4

Task / goal:
- 按用户要求将项目默认模型切到 OpenAI 当前官方推荐的旗舰模型。

Key changes:
- 将 `src/server/ai/openai.ts` 中的默认 chat/task 模型从 `gpt-5-mini` 调整为 `gpt-5.4`。
- 新增真实存在的 `.env.example`，并将 `.env.example`、`README.md` 中的推荐环境变量示例同步改为 `gpt-5.4`。

Files touched:
- `src/server/ai/openai.ts`
- `.env.example`
- `README.md`
- `docs/changelog/openai-provider-migration.md`

Verification commands and results:
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm lint` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH /usr/local/bin/pnpm build` -> ✅ 通过。
- `PATH=/usr/local/bin:$PATH; set -a; source .env.local; set +a; /usr/local/bin/node --input-type=module -e "...generateText({ model: openai(process.env.OPENAI_MODEL || 'gpt-5.4') ... })"` -> ❌ 请求已确认使用 `gpt-5.4`，但 OpenAI 返回 `insufficient_quota`（账户额度不足）。

Remaining risks / follow-up:
- `gpt-5.4` 成本高于 `gpt-5-mini`，如果后续批量摘要/探索频率很高，可能需要再拆分 chat/task 模型策略。
