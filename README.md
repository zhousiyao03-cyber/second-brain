# Second Brain

一个面向个人知识工作流的 AI Second Brain。

把笔记、碎片信息和对话沉淀到同一个地方，再用 AI 做检索、问答和回顾，不再在文档、聊天记录和临时灵感之间来回切换。

在线体验：
- https://second-brain-self-alpha.vercel.app/

## 为什么这个项目值得打开

- **不是聊天壳子**：核心是“知识沉淀 -> 检索 -> 问答 -> 持续积累”的闭环，而不是单次对话。
- **编辑器足够能打**：内置接近 Notion 工作流的块编辑体验，适合真正拿来记东西。
- **Ask AI 不是空回答**：基于知识库做 chunk 级 hybrid RAG，回答可以带来源。
- **工程味很完整**：有认证、数据隔离、E2E、构建链路和部署地址，不是停在 demo 阶段。
- **对 AI 开发者也有意思**：除了知识问答，还能看本机 Codex / Claude Code token usage。

## 适合谁

- 想做自己的 AI 知识库，而不是把内容散落在多个工具里的人
- 想看一个从前端产品感出发、再逐步补齐全栈能力的学习型项目的人
- 想参考 Next.js 16 + tRPC + Auth.js + AI SDK + SQLite/Turso 组合的人

## 现在能做什么

## 功能（V1）

- **认证** — Auth.js v5 + GitHub / Google OAuth + 邮箱密码注册 / 登录，支持在账号设置页修改昵称、邮箱和本地密码，多用户数据完全隔离；补齐了 PWA / iOS Web App metadata，主屏安装后登录态更稳定
- **笔记** — Notion 风格块编辑器，支持通栏 280px 头图与内置背景图库、轻量类型/标签 metadata 行、行级悬浮插入、324 × 385 分区插入面板、块菜单（上移/下移/复制/删除/转为）、Slash 命令、Todo/列表、Callout / Toggle、图片上传/拖拽/粘贴、自动保存，以及首页和笔记页一键打开今日日报；日报默认带 `今天的 todo / 今日的复盘 / 明日计划` 三块，并可继承最近一篇日报里的未完成明日计划
- **搜索** — Cmd+K 全局搜索笔记，关键词高亮
- **Ask AI** — 基于知识库的 chunk 级 hybrid RAG 问答，支持语义检索、关键词召回、邻近段落扩展和可点击引用来源
- **Token Usage** — 自动读取本机里的 Codex / Claude Code 本地 session（含 Claude subagents，跨工作区聚合），用于展示真实 token 用量；也支持手动补录 OpenAI API / 其他来源，统一在 Dashboard 和独立页面聚合（线上环境默认禁用，本地开发可开启）
- **Focus Tracker（进行中）** — 服务端 ingestion、Tauri collector、dashboard focus card 和 `/focus` 页面都已落地；当前已完成 V2 的服务端标签系统、富信号 ingest/status API 和 schema 迁移，`/focus` 侧已切到 tags + browser URL 数据模型；桌面端 collector 也已切到 enriched sample / pure-append outbox / server-first metrics，并通过 `cargo test` + `cargo build`，但 AX URL 抓取和多屏窗口识别还缺一次真实桌面手测收口。Web 端 `/focus` 现在会默认折叠 `<10m` 的 blocks 和 raw sessions，避免短碎片把主视图刷满；折叠只影响展示，不影响统计和入库。活动块聚合也不再只看紧邻碎片：同一语义的工作在 `10m` 内短暂切去聊天或别的 app 后再回来，即使中间连续插了多个短 interruption，也会继续并成同一段 block。浏览器语义层也开始落地：collector 现在会从 URL 提取 `host/path/query/surface_type`，服务端会按 semantic key 做第一批 block merge 和命名，Web 端展示会优先用 `Search: ...`、`GitHub PR review`、`Documentation` 这类标签，而不只是笼统的 `Google Chrome`
- **Dashboard** — 统计概览 + 最近条目 + token usage 聚合概览
- **暗色模式** — 全局可切换

冻结模块（保留代码但默认隐藏入口）：收藏、Todo、AI 探索

## 产品预览

- 主页：聚合最近笔记和 token usage，先看全局状态
- 笔记：以编辑体验为中心，支持快速记录和结构化整理
- Ask AI：对知识库发问，返回答案和引用来源
- Search：用 `Cmd+K` 快速找回笔记

如果你只是想先看效果，直接打开线上地址：
- https://second-brain-self-alpha.vercel.app/

如果你会在 iPhone 上把站点“添加到主屏幕”当作 App 使用，建议在升级后删掉旧图标并从线上地址重新添加一次。iOS 的主屏 Web App 和 Safari 标签页使用独立的网站数据容器，重新安装后再登录一次更稳。

## 技术栈

- Next.js 16 (App Router) + React 19
- Tailwind CSS v4
- tRPC v11 + Zod v4
- Drizzle ORM + SQLite (libsql / Turso)
- Auth.js v5 (GitHub / Google OAuth)
- Vercel AI SDK v6 + OpenClaw / Codex OAuth（默认 `gpt-5.4`）/ OpenAI API / 本地 OpenAI-compatible 模型服务
- @mozilla/readability + linkedom
- Playwright (E2E)

## 快速开始

```bash
nvm use          # 使用 .nvmrc 中固定的 Node 版本（首次可先 nvm install）
pnpm install
cp .env.example .env.local
pnpm db:push       # 初始化数据库
pnpm dev            # 启动开发服务器 http://localhost:3200
```

本地开发模式下，访问登录页会自动确保一个固定的 TEST 账号存在，方便直接进站验证：

```text
邮箱: test@secondbrain.local
密码: test123456
```

这个账号只会在 `NODE_ENV=development` 时自动创建或重置，不会影响生产环境。

需要先基于仓库里的 `.env.example` 生成 `.env.local`，再按需调整环境变量。完整的环境变量示例：

```bash
# .env.local 示例

# ── 数据库 ──────────────────────────────────────────
TURSO_DATABASE_URL=file:data/second-brain.db  # 本地开发

# ── 认证 ────────────────────────────────────────────
AUTH_SECRET=local-dev-secret
# AUTH_GITHUB_ID=...        # 部署时配置
# AUTH_GITHUB_SECRET=...
# AUTH_GOOGLE_ID=...
# AUTH_GOOGLE_SECRET=...

# ── AI ──────────────────────────────────────────────
AI_PROVIDER=openai           # 线上用 openai
OPENAI_API_KEY=...           # 线上配置
# 本地开发可继续用 codex：
# AI_PROVIDER=codex

# ── 功能开关 ─────────────────────────────────────────
ENABLE_TOKEN_USAGE=true
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=true
```

本地开发默认推荐直接复用你已经登录好的 OpenClaw / Codex OAuth（`AI_PROVIDER=codex`）。这条路线不会使用 `OPENAI_API_KEY`，运行时会直接读取 `~/.openclaw/openclaw.json` 和 `~/.openclaw/agents/main/agent/auth-profiles.json`，按 OpenClaw 当前默认的 `openai-codex/gpt-5.4` 配置去请求 `chatgpt.com/backend-api`。

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

Focus Tracker collector 的本地原型也已经放在仓库里，当前用于先打通“macOS 采样 -> ingestion API -> 数据库入库”的链路。个人部署时可以给服务端配置：

```bash
FOCUS_INGEST_API_KEY=your-focus-ingest-api-key
FOCUS_INGEST_USER_ID=your-user-id
```

然后本地运行 collector：

```bash
FOCUS_COLLECTOR_BASE_URL=http://127.0.0.1:3200 \
FOCUS_COLLECTOR_API_KEY=your-focus-ingest-api-key \
pnpm focus:collector
```

如果只想做一次 fixture / dry-run 验证：

```bash
pnpm focus:collector --fixture tools/focus-collector/fixtures/demo-sessions.json --dry-run
```

现在仓库里还新增了一个独立的 Tauri collector 目录 `focus-tracker/`，用于把 collector 从 Node prototype 迁到真实桌面 runtime。当前已经能 `cargo test`、`cargo check`、`pnpm build`，并可用 `pnpm tauri dev --no-watch` 启动 tray + 后台采样原型；面板已经收成标准 menubar popover，点击 tray icon 会贴着状态栏图标弹出，菜单栏顶栏会直接显示 `Working Hours · 8h progress`，面板内则保留一条更紧凑的 canonical timeline 和 `/focus` 入口，并直接对齐 `/focus` 的服务端日统计。

注意：`focus-tracker/` 是独立桌面工程。根目录的 `pnpm build` 只构建 Web 应用；桌面端需要进入 `focus-tracker/` 单独构建。

在 Web 端，`/focus` 页面现在已经可用：

- dashboard 上有 Focus card，可直接进入 `/focus`
- `/focus` 支持 true time-of-day timeline、top apps、weekly bars、merged focus blocks，以及单独展示被 `social-media / entertainment / gaming` 排除出 `Working Hours` 的时间
- `/focus` 与 dashboard 现在默认强调 `Working Hours`（工作类别的 focused time），而不是把所有活跃 span 全算成工作
- `/focus` 支持手动刷新 session 分类和 daily summary
- `/focus` 支持为桌面端生成一次性 pairing code，桌面 collector 输入 code 后会自动换成 per-device token；设备列表会显示 `Connected / Recent / Revoked / Last seen`，配对与连接失败也会给出重连指引

## 常用命令

```bash
pnpm dev            # 开发服务器
pnpm build          # 生产构建（含 TypeScript 检查）
pnpm lint           # ESLint 检查
pnpm test:e2e       # E2E 测试（使用独立测试库，不污染 data/second-brain.db）
pnpm focus:collector # 运行 Focus Tracker collector 原型
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
pnpm exec agent-browser open http://127.0.0.1:3200/notes
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
    focus/          Focus Tracker 的区间切片与聚合逻辑
    ai/             AI 相关逻辑（chunking、indexer、hybrid RAG、本地/云端 provider、URL 内容抓取）
e2e/                Playwright E2E 测试
focus-tracker/      Tauri 桌面端 collector（tray、采样、sessionize、上传）
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
- [x] Vercel 部署准备：Auth.js 认证 + Turso 数据库 + 数据隔离

详见 `docs/v1-plan.md` 和 `docs/changelog/`。
