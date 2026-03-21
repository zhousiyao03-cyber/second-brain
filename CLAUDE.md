@AGENTS.md

# Second Brain — 开发规范

## 项目概述

个人知识管理平台，替代 Notion，集成 AI 能力。技术栈：Next.js 15 + React 19 + Tailwind CSS v4 + Tiptap + tRPC v11 + SQLite + Drizzle ORM + Claude API。

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

### 5. 每个 Phase 完成后必须 commit

验证全部通过后，创建一个 git commit 留底：
- commit message 格式：`feat: complete phase {N} - {简要描述}`
- 确保只提交项目文件，不要提交 `data/*.db`、`.next/`、`node_modules/` 等
- commit 前先 `git status` 确认待提交文件列表合理

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
├── app/              # Next.js App Router 页面
├── components/       # React 组件
│   ├── ui/           # 通用 UI 组件
│   └── layout/       # 布局组件
├── server/
│   ├── db/           # 数据库连接和 schema
│   ├── routers/      # tRPC routers
│   └── ai/           # AI 相关逻辑
└── lib/              # 工具函数和客户端配置
e2e/                  # Playwright E2E 测试
docs/changelog/       # Phase 完成留档
```

## 代码规范

- 使用 `zod/v4` 进行输入校验（项目安装的是 zod v4）
- tRPC router 使用 `publicProcedure`
- ID 生成使用 `crypto.randomUUID()`
- 样式使用 Tailwind CSS，工具函数 `cn()` 位于 `src/lib/utils.ts`
- 客户端组件必须标记 `"use client"`
- 不要留下脚手架默认文档或占位文件

## 技术备忘（已踩坑记录）

以下是开发中遇到的与训练数据不一致的 API 差异，compact 后恢复时务必参考：

### Vercel AI SDK v6 (ai@^5 / @ai-sdk/react@^3)
- `ai/react` 模块不存在，React hooks 在独立包 `@ai-sdk/react` 中
- `useChat` 不再有 `api`/`input`/`handleInputChange`/`handleSubmit`/`isLoading` 属性
- `useChat` 现在需要 `transport` 参数：`new TextStreamChatTransport({ api: "/api/chat" })` from `ai`
- `useChat` 返回 `sendMessage({ text: string })`（不是 `content`），`status`（不是 `isLoading`）
- `streamText()` 的结果用 `.toTextStreamResponse()`（不是 `toDataStreamResponse`）
- `message.parts` 数组替代了 `message.content`，用 `part.type === "text"` 渲染

### React 19
- `useRef` 必须传初始值：`useRef<T>(undefined)`
- Next.js 15 页面 params 是 `Promise`，需要 `use(params)` 解包

### Tiptap
- SSR 环境必须设置 `immediatelyRender: false` 避免 hydration 错误

### E2E 测试
- 测试数据用 `uid()` 随机名避免冲突（共享 SQLite DB）
- `h1` 选择器用 `page.locator("main h1")` 避免 sidebar 标题冲突
- group hover 按钮需要先 hover 再点击，或用 `{ force: true }`
