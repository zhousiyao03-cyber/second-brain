# Second Brain

个人 AI 知识管理平台。把信息（笔记、URL、文本片段）存进来，AI 自动理解，随时搜索和问答。

## 功能（V1）

- **笔记** — Notion 风格块编辑器，支持通栏 280px 头图与内置背景图库、轻量类型/标签 metadata 行、行级悬浮插入、324 × 385 分区插入面板、块菜单（上移/下移/复制/删除/转为）、Slash 命令、Todo/列表、Callout / Toggle、图片上传/拖拽/粘贴、自动保存，以及一键新建带日期标题与 Todo 模版的日记
- **收藏** — URL 收藏自动抓取正文（Readability），AI 生成摘要和标签
- **搜索** — Cmd+K 全局搜索笔记、收藏、待办，关键词高亮
- **Ask AI** — 基于知识库的 chunk 级 hybrid RAG 问答，支持语义检索、关键词召回、邻近段落扩展和可点击引用来源
- **Token Usage** — 自动读取本机里的 Codex / Claude Code 本地 session（含 Claude subagents，跨工作区聚合），用于展示真实 token 用量；也支持手动补录 OpenAI API / 其他来源，统一在 Dashboard 和独立页面聚合
- **Dashboard** — 统计概览 + 最近条目 + token usage 聚合概览
- **暗色模式** — 全局可切换

冻结模块（保留但不活跃开发）：Todo、AI 探索

## 技术栈

- Next.js 16 (App Router) + React 19
- Tailwind CSS v4
- tRPC v11 + Zod v4
- Drizzle ORM + SQLite (better-sqlite3)
- Vercel AI SDK v6 + OpenClaw / Codex OAuth（默认 `gpt-5.4`）/ OpenAI API / 本地 OpenAI-compatible 模型服务
- @mozilla/readability + linkedom
- Playwright (E2E)

## 快速开始

```bash
nvm use          # 使用 .nvmrc 中固定的 Node 版本（首次可先 nvm install）
pnpm install
cp .env.example .env.local
pnpm db:push       # 初始化数据库
pnpm dev            # 启动开发服务器 http://localhost:3000
```

需要先基于仓库里的 `.env.example` 生成 `.env.local`，再按需调整环境变量。默认推荐直接复用你已经登录好的 OpenClaw / Codex OAuth：

```bash
# .env.local
AI_PROVIDER=codex

# 下面这些通常可以不写，默认会读取 OpenClaw 的标准位置
# CODEX_AUTH_STORE_PATH=/Users/yourname/.openclaw/agents/main/agent/auth-profiles.json
# CODEX_AUTH_PROFILE_ID=openai-codex:default
# CODEX_MODEL=gpt-5.4
# CODEX_CHAT_MODEL=gpt-5.4
# CODEX_TASK_MODEL=gpt-5.4
```

这条路线不会使用 `OPENAI_API_KEY`。运行时会直接读取 `~/.openclaw/openclaw.json` 和 `~/.openclaw/agents/main/agent/auth-profiles.json`，按 OpenClaw 当前默认的 `openai-codex/gpt-5.4` 配置去请求 `chatgpt.com/backend-api`。为了让 Next.js 服务端运行更稳定，仓库内部固定走 SSE transport，而不是 OpenClaw 里的 `auto` WebSocket/SSE 策略。

如果你想让 Ask AI 的新 chunk 级 RAG 同时开启语义检索，需要额外配置 embedding provider。最简单的两条路是：

```bash
# 方案 A：继续用 Codex 聊天，但 embedding 走 OpenAI API
AI_PROVIDER=codex
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

```bash
# 方案 B：继续用 Codex 聊天，但 embedding 走本地 OpenAI-compatible 服务
AI_PROVIDER=codex
EMBEDDING_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_EMBEDDING_MODEL=nomic-embed-text
AI_API_KEY=local
```

如果你不配置 embedding provider，Ask AI 仍然能工作，但会退化成 chunk 级关键词检索，而不会启用语义召回。

如果你之后想切回标准 OpenAI API，也可以：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.4

# 可选：按场景拆分模型
# OPENAI_CHAT_MODEL=gpt-5.4
# OPENAI_TASK_MODEL=gpt-5.4
```

如果你之后想切回本地 OpenAI-compatible 服务，也可以：

```bash
AI_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=qwen2.5:14b

# 可选：按场景拆分模型
# AI_CHAT_MODEL=qwen2.5:14b
# AI_TASK_MODEL=qwen2.5:14b
# AI_API_KEY=local
```

常见本地服务示例：
- Ollama: `AI_BASE_URL=http://127.0.0.1:11434/v1`
- LM Studio: `AI_BASE_URL=http://127.0.0.1:1234/v1`

如果走本地模式，推荐先拉一个经过当前项目实测的模型：

```bash
ollama pull qwen2.5:14b
```

聊天模型配置统一通过 `src/server/ai/provider.ts` 读取这些环境变量。现在支持三种模式：`codex`、`openai`、`local`。如果你没有显式设置 `AI_PROVIDER`，运行时会优先尝试复用本机已有的 OpenClaw Codex 登录态。embedding 配置则由 `src/server/ai/embeddings.ts` 独立解析，支持 `EMBEDDING_PROVIDER=openai|local|none`。

`/usage` 页面还会尝试直接读取本机对应的本地 usage 数据，并默认每 15 秒自动刷新一次：
- Codex：`~/.codex/state*.sqlite` 里的全局 thread token 统计
- Claude Code：`~/.claude/projects/` 下所有项目的 session 与 `subagents/*.jsonl` usage 聚合

如果你想调整这个自动刷新频率，可以设置：

```bash
NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS=15000
```

如果这两个目录不存在，页面会显示“未发现”，但手动录入仍然可用。

## 常用命令

```bash
pnpm dev            # 开发服务器
pnpm build          # 生产构建（含 TypeScript 检查）
pnpm lint           # ESLint 检查
pnpm test:e2e       # E2E 测试（使用独立测试库，不污染 data/second-brain.db）
pnpm run browser:install  # 可选：下载 Chrome for Testing，供 agent-browser 使用
pnpm db:generate    # 生成数据库迁移
pnpm db:push        # 应用迁移到数据库
pnpm db:studio      # Drizzle Studio
```

## Browser 验证

仓库现在内置了 `agent-browser` 作为本地开发依赖，我后续可以直接用 `pnpm exec agent-browser ...` 做页面级验证。

- 如果你的机器已经装了 Chrome，`agent-browser` 通常会直接复用它。
- 如果你想固定使用 Chrome for Testing，先执行一次 `pnpm run browser:install`。
- 一个最小例子：

```bash
pnpm exec agent-browser open http://127.0.0.1:3000/notes
pnpm exec agent-browser snapshot -i
pnpm exec agent-browser close
```

## 项目结构

```
src/
  app/              Next.js App Router 页面和 API 路由
  components/       UI 和布局组件（toast、search-dialog、editor）
  lib/              客户端工具函数和 tRPC client
  server/
    db/             数据库连接和 schema
    routers/        tRPC routers
    ai/             AI 相关逻辑（chunking、indexer、hybrid RAG、本地/云端 provider、URL 内容抓取）
e2e/                Playwright E2E 测试
docs/
  v1-plan.md        V1 收敛执行计划
  changelog/        变更记录
```

## V1 收敛进度

- [x] Pass 1: 产品收敛（隐藏 Workflows/Learn）
- [x] Pass 2: Bookmark 内容抓取 + AI 摘要修复
- [x] Pass 3: Ask AI RAG 实现
- [x] Pass 4: Search 增强 + API 加固
- [x] Pass 5: UX/UI 打磨 + 暗色模式
- [x] Pass 6: E2E 收尾 + 工程文档收口

详见 `docs/v1-plan.md` 和 `docs/changelog/v1-convergence.md`。
