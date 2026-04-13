@AGENTS.md

# Second Brain — 开发规范

## 项目概述

个人知识管理平台，替代 Notion，集成 AI 能力。技术栈：Next.js 16 + React 19 + Tailwind CSS v4 + Tiptap v3 + tRPC v11 + SQLite (libsql/Turso) + Drizzle ORM + Vercel AI SDK v6。

## 开发流程约束

### 1. 每个 Phase 完成后必须留档

每完成一个 Phase，必须在 `docs/changelog/` 下创建对应的 markdown 文件记录：
- 文件命名：`phase-{N}.md`
- 内容包含：完成的功能列表、新增/修改的文件清单、数据库变更、已知问题
- 同步更新 `README.md` 中的进度 checklist

### 2. 每次修改必须自验证

完成代码修改后，必须依次执行以下验证步骤（任何一步失败必须先修复再继续）：

```bash
# Step 1: TypeScript 编译检查
pnpm build

# Step 2: ESLint 代码质量检查
pnpm lint

# Step 3: E2E 测试
pnpm test:e2e
```

不可以声称"看起来应该没问题"就跳过验证。如果环境不支持执行，必须明确说明阻塞原因。

### 3. E2E 测试要求

- 每个 Phase 必须有对应的 E2E 测试文件：`e2e/phase{N}.spec.ts`
- 新增的 UI 功能必须有 E2E 测试覆盖（至少覆盖核心用户流程）
- CRUD 功能必须测试：创建 → 列表展示 → 编辑 → 删除 完整流程
- 测试必须全部通过后才能认为 Phase 完成

### 4. 数据库变更规范

- schema 修改后必须运行 `pnpm db:generate` 生成迁移
- 然后运行 `pnpm db:push` 应用到本地数据库
- 迁移文件必须提交到版本控制
- 如果这次 schema 变更会影响线上环境，不能停在本地：
  - 必须确认生产 Turso 是否已经同步到新 schema
  - 如果 `drizzle-kit push` 不能稳定用于生产，必须执行一次明确记录过的 production schema rollout
  - rollout 后必须用实际查询验证线上表 / 列已经存在
  - 没做完这一步，不算“已上线完成”

### 5. 每个 Phase 完成后必须 commit

验证全部通过后，创建一个 git commit 留底：
- commit message 格式：`feat: complete phase {N} - {简要描述}`
- 确保只提交项目文件，不要提交 `data/*.db`、`.next/`、`node_modules/` 等
- commit 前先 `git status` 确认待提交文件列表合理
- **任务完成且验证通过后，直接 `git push` 到远程，不需要询问用户确认**

### 6. 自动清理 — 禁止垃圾文件

每个 Phase 完成时，必须检查并清理以下类型的废物文件：
- 框架脚手架生成但未使用的默认文件（如默认 SVG、示例页面）
- 不再被任何代码 import/引用的文件
- 空目录
- 重复或过时的配置/文档

清理检查命令参考：
```bash
# 检查 public/ 下是否有未引用的静态资源
ls public/

# 检查是否有空目录（排除 node_modules 和 .git）
find . -type d -empty -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*'
```

原则：项目中的每个文件都必须有存在的理由。如果不确定是否有用，先 grep 搜索引用再决定。

### 7. npm 源注意事项

本机默认 npm registry 是字节内网源 (`bnpm.byted.org`)，部分公网包可能下载失败。安装新依赖时如果遇到下载问题，临时切换到官方源：

```bash
npm config set registry https://registry.npmjs.org/
pnpm add <package>
npm config set registry https://bnpm.byted.org/   # 装完切回
```

## 常用命令

```bash
pnpm dev            # 启动开发服务器
pnpm build          # 构建（含 TypeScript 检查）
pnpm lint           # ESLint 检查
pnpm test:e2e       # 运行 E2E 测试
pnpm db:generate    # 生成数据库迁移
pnpm db:push        # 应用迁移到数据库
pnpm db:studio      # 打开 Drizzle Studio
```

## 项目结构

```
src/
├── app/              # Next.js App Router 页面和 API 路由
│   └── (app)/        # 认证后的主路由组（notes, learn, projects, portfolio, ask, focus, usage 等）
├── components/       # React 组件
│   ├── ui/           # 通用 UI 组件（toast, search-dialog 等）
│   ├── layout/       # 布局组件（sidebar, mobile-nav）
│   └── editor/       # Tiptap 编辑器（核心组件 + 扩展块）
│       ├── tiptap-editor.tsx       # 主编辑器（扩展注册、block 操作、拖拽、粘贴处理）
│       ├── editor-commands.ts      # Slash 命令定义
│       ├── editor-block-ops.ts     # 块级操作（移动、复制、删除、插入）
│       ├── slash-command.tsx        # Slash 命令菜单 UI
│       ├── bubble-toolbar.tsx       # 文本选中浮动工具栏
│       ├── table-toolbar.tsx        # 表格操作工具栏
│       ├── search-replace.tsx       # 搜索替换
│       ├── callout-block.tsx        # Callout 提示块
│       ├── toggle-block.tsx         # 折叠/展开块
│       ├── code-block-with-lang.tsx # 代码块（语言选择器）
│       ├── mermaid-block.tsx        # Mermaid 图表块（全屏查看 + 编辑）
│       ├── excalidraw-block.tsx     # Excalidraw 画板块
│       ├── image-row-block.tsx      # 并排图片行（拖拽排序、resize、拖出提取）
│       ├── toc-block.tsx            # 目录块
│       ├── toc-sidebar.tsx          # 侧边目录导航
│       ├── markdown-table-paste.ts  # 混合 Markdown 粘贴（Mermaid + 表格自动转换）
│       └── knowledge-note-editor.tsx # 笔记编辑器封装
├── server/
│   ├── db/           # 数据库连接和 schema（Drizzle ORM + libsql）
│   ├── routers/      # tRPC routers（notes, learning-notebook, oss-projects, portfolio 等）
│   ├── ai/           # AI 逻辑（chunking, indexer, hybrid RAG, provider 抽象, URL 抓取）
│   └── focus/        # Focus Tracker 区间切片与聚合
└── lib/              # 工具函数和客户端配置（tRPC client, cn(), note-templates）
e2e/                  # Playwright E2E 测试
docs/changelog/       # Phase 完成留档
```

## 代码规范

- **所有用户可见的文案（UI 文本、按钮、placeholder、错误提示、aria-label 等）必须使用英文。** 代码注释和内部日志语言不限，但对外展示一律英文。
- 使用 `zod/v4` 进行输入校验（项目安装的是 zod v4）
- tRPC router 使用 `publicProcedure`
- ID 生成使用 `crypto.randomUUID()`
- 样式使用 Tailwind CSS，工具函数 `cn()` 位于 `src/lib/utils.ts`
- 客户端组件必须标记 `"use client"`
- 不要留下脚手架默认文档或占位文件

### 编辑器开发规范

- 编辑器基于 Tiptap v3（ProseMirror），自定义块统一用 `Node.create` + `ReactNodeViewRenderer`
- 自定义块必须设置 `data-editor-block="true"` 和对应的 `data-xxx-block="true"` 属性
- 新增块类型必须：注册到 `tiptap-editor.tsx` 的 extensions 列表、加到 `BLOCK_SELECTOR`、加到非 transformable 列表
- Slash 命令在 `editor-commands.ts` 中定义，分组为 basic / lists / blocks / media
- 块的 CSS 统一写在 `globals.css`，必须包含 dark mode 样式
- 粘贴处理优先级：图片文件（editorProps.handlePaste）> Markdown 结构（MarkdownTablePaste 插件）
- 图片拖拽合并使用模块级变量 `gripDragSource` 跟踪拖拽源，在 `handleDrop` 中检测合并
- Mermaid 使用 `securityLevel: "strict"`（禁止 `"loose"`，防止 XSS）

## 技术备忘与恢复指南

详细内容已拆分到 `.claude/rules/` 目录（按需加载，减少启动 context）：
- `.claude/rules/api-pitfalls.md` — API 踩坑记录（Vercel AI SDK v6、React 19、Tiptap、E2E）
- `.claude/rules/compact-recovery.md` — Compact 后的恢复步骤与核心规则
- `.claude/rules/handoff-protocol.md` — 跨会话交接协议（HANDOFF.md 规范）
- `.claude/rules/production-turso.md` — 生产 Turso 凭证位置与访问规范（**AI 不要再问 URL/Token**，已在 `.env.turso-prod.local`）
