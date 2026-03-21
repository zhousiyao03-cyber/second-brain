# Second Brain

个人知识管理平台，替代 Notion，集成 AI 能力（摘要、RAG 问答、Agent 工作流）。

## 技术栈

- Next.js 15 (App Router) + React 19
- Tailwind CSS v4 + shadcn/ui
- tRPC v11 + Zod v4
- Drizzle ORM + SQLite (better-sqlite3)
- Playwright (E2E)
- 计划中: Claude API + Vercel AI SDK + orama

## 快速开始

```bash
pnpm install
pnpm db:push       # 初始化数据库
pnpm dev            # 启动开发服务器 http://localhost:3000
```

## 常用命令

```bash
pnpm dev            # 开发服务器
pnpm build          # 生产构建（含 TypeScript 检查）
pnpm lint           # ESLint 检查
pnpm test:e2e       # E2E 测试
pnpm db:generate    # 生成数据库迁移
pnpm db:push        # 应用迁移到数据库
pnpm db:studio      # Drizzle Studio
```

## 项目结构

```
src/
  app/              Next.js App Router 页面和 API 路由
  components/       UI 和布局组件
  lib/              客户端工具函数和 tRPC client
  server/           数据库、schema、tRPC routers
e2e/                Playwright E2E 测试
drizzle/            数据库迁移文件
docs/changelog/     各 Phase 完成留档
```

## 进度

- [x] Phase 1: 项目骨架 + 基础布局
- [ ] Phase 2: 笔记本模块
- [ ] Phase 3: Todo + 收藏箱模块
- [ ] Phase 4: AI 能力集成
- [ ] Phase 5: AI 探索 + AI 工作流 + 学习模块
- [ ] Phase 6: Lark 集成 + 完善

详见 `PLAN.md` 和 `docs/changelog/`。
