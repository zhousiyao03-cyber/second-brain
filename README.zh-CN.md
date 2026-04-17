[English](README.md) | [中文](README.zh-CN.md)

# Second Brain

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss) ![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?logo=trpc) ![SQLite](https://img.shields.io/badge/SQLite-libsql%2FTurso-003B57?logo=sqlite) ![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)

一个面向个人知识工作流的 AI Second Brain。

把笔记、碎片信息和对话沉淀到同一个地方，再用 AI 做检索、问答和回顾，不再在文档、聊天记录和临时灵感之间来回切换。

在线体验：
- https://www.knosi.xyz/

## 为什么这个项目值得打开

- **不是聊天壳子**：核心是"知识沉淀 -> 检索 -> 问答 -> 持续积累"的闭环，而不是单次对话。
- **编辑器足够能打**：内置接近 Notion 工作流的块编辑体验，适合真正拿来记东西。
- **Ask AI 不是空回答**：基于知识库做 chunk 级 hybrid RAG，回答可以带来源。
- **工程味很完整**：有认证、数据隔离、E2E、构建链路和部署地址，不是停在 demo 阶段。
- **对 AI 开发者也有意思**：除了知识问答，还能看本机 Codex / Claude Code token usage。

## 适合谁

- 想做自己的 AI 知识库，而不是把内容散落在多个工具里的人
- 想看一个从前端产品感出发、再逐步补齐全栈能力的学习型项目的人
- 想参考 Next.js 16 + tRPC + Auth.js + AI SDK + SQLite/Turso 组合的人

## 功能

- **认证** — Auth.js v5 + GitHub / Google OAuth + 邮箱密码注册 / 登录，支持在账号设置页修改昵称、邮箱和本地密码，多用户数据完全隔离；补齐了 PWA / iOS Web App metadata，主屏安装后登录态更稳定
- **笔记** — Notion 风格块编辑器，功能包括：
  - 通栏 280px 头图与内置背景图库、轻量类型/标签 metadata 行
  - 行级悬浮插入、324 × 385 分区插入面板、块菜单（上移/下移/复制/删除/转为）、Slash 命令
  - 拖拽排序块、Todo/列表、Callout / Toggle、H1–H6 标题
  - 表格（含工具栏）、文字颜色、Mermaid 图表、Excalidraw 画板
  - 图片上传/拖拽/粘贴、四角手柄缩放、拖拽合并并排图片行（拖出可拆分）
  - 代码块语言选择器、搜索替换、键盘快捷键提示
  - TOC 目录块 + 可折叠 TOC 侧边栏
  - Mermaid 图表全屏查看 + 内联编辑（实时预览）
  - Markdown 混合粘贴（自动识别 Mermaid 代码块和 Markdown 表格并转为富文本）
  - 自动保存 + 内容防丢失机制
  - 公开只读链接分享，分享出去的笔记无需登录即可查看
  - 首页和笔记页一键打开今日日报；日报标题写成"日期 + 星期几"，默认带三块模板，并可继承最近日报的未完成计划
- **Learning Notebook** — 以 topic 组织学习内容，支持主题卡片（可编辑/删除）、主题内笔记列表、标签筛选、AI draft 起草、知识大纲 / 盲点分析 / 复习题生成，以及基于主题笔记上下文的 Ask AI
- **Open Source Projects** — 以项目维度沉淀开源代码阅读笔记，支持 repo 元信息、项目内笔记编辑、标签筛选、单篇项目笔记只读链接分享和长期分析归档
- **Portfolio** — 投资组合追踪，支持持仓管理（股票/加密货币）、Yahoo Finance + CoinGecko 实时价格、AI 持仓分析、GPT 新闻聚合（Marketaux / Google News RSS）与服务器 cron 自动刷新
- **搜索** — Cmd+K 全局搜索笔记，关键词高亮
- **Ask AI** — 基于知识库的 chunk 级 hybrid RAG 问答，支持语义检索、关键词召回、邻近段落扩展和可点击引用来源
- **Token Usage** — 自动读取本机里的 Codex / Claude Code 本地 session（含 Claude subagents，跨工作区聚合），用于展示真实 token 用量；也支持手动补录 OpenAI API / 其他来源，统一在 Dashboard 和独立页面聚合（线上环境默认禁用，本地开发可开启）
- **Focus Tracker** — 服务端 ingestion、dashboard focus card 和 `/focus` 页面；Web 端按当天原始 session 累计每个 app 的使用时长，默认折叠 <10m 的短 session；支持手动刷新分类和 daily summary。桌面端 Tauri collector 已迁移到[独立仓库](https://github.com/zhousiyao03-cyber/focus-tracker) —— **[⬇️ 下载 macOS 安装包](https://github.com/zhousiyao03-cyber/focus-tracker/releases/latest/download/focus-tracker_0.2.0_aarch64.dmg)**（Apple Silicon），登录 Knosi 账号即可开始采集
- **Dashboard** — 统计概览 + 最近条目 + token usage 聚合概览
- **暗色模式** — 全局可切换

冻结模块（保留代码但默认隐藏入口）：收藏、Todo、AI 探索

## 产品预览

- **主页**：聚合最近笔记和 token usage，先看全局状态
- **笔记**：以编辑体验为中心，支持快速记录、结构化整理，以及公开只读分享
- **Learning Notebook**：围绕某个学习主题持续写、持续问、持续复盘
- **Open Source Projects**：按项目保存代码阅读结论和架构摘录，也能把单篇项目笔记作为只读页面分享出去
- **Portfolio**：追踪持仓、实时价格和相关新闻
- **Ask AI**：对知识库发问，返回答案和引用来源
- **Search**：用 `Cmd+K` 快速找回笔记

如果你只是想先看效果，直接打开线上地址：
- https://www.knosi.xyz/

如果你会在 iPhone 上把站点"添加到主屏幕"当作 App 使用，建议在升级后删掉旧图标并从线上地址重新添加一次。iOS 的主屏 Web App 和 Safari 标签页使用独立的网站数据容器，重新安装后再登录一次更稳。

## 技术栈

- Next.js 16 (App Router) + React 19
- Tailwind CSS v4
- tRPC v11 + Zod v4
- Drizzle ORM + SQLite (libsql / Turso)
- Auth.js v5 (GitHub / Google OAuth)
- Vercel AI SDK v6 + OpenClaw / Codex OAuth（默认 `gpt-5.4`）/ OpenAI API / 本地 OpenAI-compatible 模型服务
- @excalidraw/excalidraw + mermaid（编辑器画板和图表）
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
# MARKETAUX_API_KEY=...      # Portfolio 新闻源（推荐）
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

`/portfolio` 的新闻面板现在优先使用 `MARKETAUX_API_KEY` 对应的 Marketaux 新闻源，按 ticker + 持仓名称做更可靠的过滤；如果没有配置 `MARKETAUX_API_KEY`，会自动回退到 Google News RSS。建议本地和线上都配置 Marketaux，否则歧义 ticker 的新闻质量会明显变差。

`/usage` 页面还会尝试直接读取本机对应的本地 usage 数据，并默认每 15 秒自动刷新一次：
- Codex：`~/.codex/state*.sqlite` 里的全局 thread token 统计
- Claude Code：`~/.claude/projects/` 下所有项目的 session 与 `subagents/*.jsonl` usage 聚合

如果你想调整这个自动刷新频率，可以设置：

```bash
NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS=15000
```

如果这两个目录不存在，页面会显示"未发现"，但手动录入仍然可用。

Focus Tracker 的服务端 ingestion 和 `/focus` Web 页面保留在本仓库。桌面端 Tauri collector 已迁移到[独立仓库](https://github.com/zhousiyao03-cyber/focus-tracker) —— **[⬇️ 直接下载 macOS 安装包](https://github.com/zhousiyao03-cyber/focus-tracker/releases/latest/download/focus-tracker_0.2.0_aarch64.dmg)**（Apple Silicon），拖到 `/Applications`，打开后登录 Knosi 账号即可。

个人部署时可以给服务端配置：

```bash
FOCUS_INGEST_API_KEY=your-focus-ingest-api-key
FOCUS_INGEST_USER_ID=your-user-id
```

Web 端 `/focus` 页面功能：

- Dashboard 上有 Focus card，可直接进入 `/focus`
- App-first 页面：先看当天累计时长的 top apps，再看选中 app 的 session 明细和 mini timeline，全局 day timeline 辅助确认时间分布
- Working Hours 辅助口径：按累计时长减去 non-work tags（social-media / entertainment / gaming）计算
- 支持手动刷新 session 分类和 daily summary
- 支持为桌面端生成一次性 pairing code，桌面 collector 输入 code 后自动换成 per-device token

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
    routers/        tRPC routers（notes、learning-notebook、oss-projects、portfolio 等）
    focus/          Focus Tracker 的区间切片与聚合逻辑
    ai/             AI 相关逻辑（chunking、indexer、hybrid RAG、本地/云端 provider、URL 内容抓取）
e2e/                Playwright E2E 测试
docs/
  v1-plan.md        V1 收敛执行计划
  changelog/        变更记录
```

各功能模块主要落在：

- 学习：`src/app/(app)/learn/**` + `src/server/routers/learning-notebook.ts` + `src/app/api/learn/draft/route.ts`
- 开源项目：`src/app/(app)/projects/**` + `src/server/routers/oss-projects.ts`
- 投资组合：`src/app/(app)/portfolio/**` + `src/server/routers/portfolio.ts`
- 编辑器扩展：`src/components/editor/`（mermaid-block、excalidraw-block、image-row-block、toc-block、toc-sidebar、markdown-table-paste、callout-block、toggle-block 等）

## 开发进度

### V1 收敛（已完成）

- [x] Pass 1–6: 产品收敛、Bookmark 抓取 + AI 摘要、Ask AI RAG、Search 增强、UX/UI 打磨 + 暗色模式、E2E 收尾
- [x] 自托管部署准备：Auth.js 认证 + Turso 数据库 + 数据隔离 + Hetzner Docker Compose 部署链路

### V1 后续迭代

- [x] Focus Tracker：服务端 ingestion + Web `/focus` 页面 + 桌面端 Tauri collector（已迁至独立仓库）
- [x] Portfolio：持仓管理 + 实时价格 + AI 分析 + 新闻聚合
- [x] Learning Notebook & Open Source Projects：主题/项目维度的笔记 + AI 辅助
- [x] 编辑器增强：Mermaid 图表、Excalidraw 画板、表格工具栏、并排图片、TOC 侧边栏、拖拽排序、搜索替换、H1–H6 标题
- [x] 性能优化：路由切换 loading skeleton、动态 import、查询缓存
- [ ] Meeting Assistant：Tauri v2 桌面端会议助手（规划中）

详见 `docs/v1-plan.md` 和 `docs/changelog/`。
