# Phase 1：项目骨架 + 基础布局

**完成日期**：2026-03-21

## 完成的功能

1. Next.js 15 项目初始化（TypeScript + Tailwind CSS v4 + App Router）
2. 安装所有核心依赖（Drizzle ORM, better-sqlite3, tRPC v11, React Query, lucide-react 等）
3. SQLite 数据库配置 + 8 张表 schema 定义 + 迁移生成
4. tRPC 基础设施搭建（server/client/provider/API route）
5. 侧边栏导航布局（8 个模块：Dashboard/笔记/收藏/Todo/学习/AI探索/Ask AI/工作流）
6. 所有模块占位页面
7. Playwright E2E 测试配置 + Phase 1 测试用例

## 新增文件清单

### 配置文件
- `drizzle.config.ts` — Drizzle ORM 配置
- `playwright.config.ts` — E2E 测试配置
- `CLAUDE.md` — 开发规范

### 数据库
- `src/server/db/index.ts` — SQLite 连接
- `src/server/db/schema.ts` — 8 张表的 schema 定义
- `drizzle/0000_tan_randall_flagg.sql` — 初始迁移

### tRPC
- `src/server/trpc.ts` — tRPC 初始化
- `src/server/routers/_app.ts` — 根 router
- `src/server/routers/notes.ts` — 笔记 CRUD
- `src/server/routers/bookmarks.ts` — 收藏 CRUD
- `src/server/routers/todos.ts` — Todo CRUD
- `src/app/api/trpc/[trpc]/route.ts` — API 路由
- `src/lib/trpc.ts` — tRPC 客户端
- `src/components/providers.tsx` — Provider 组件

### 布局和页面
- `src/components/layout/sidebar.tsx` — 侧边栏导航
- `src/lib/utils.ts` — cn() 工具函数
- `src/app/page.tsx` — Dashboard（修改）
- `src/app/notes/page.tsx`
- `src/app/bookmarks/page.tsx`
- `src/app/todos/page.tsx`
- `src/app/learn/page.tsx`
- `src/app/explore/page.tsx`
- `src/app/ask/page.tsx`
- `src/app/workflows/page.tsx`

### 测试
- `e2e/phase1.spec.ts` — 11 个测试用例

## 数据库变更

初始化 8 张表：notes, bookmarks, todos, chat_messages, workflows, learning_paths, learning_lessons, workflow_runs

## 验证结果

- `pnpm build` ✅ 编译通过
- `pnpm lint` ✅ 无 ESLint 错误
- `pnpm test:e2e` ✅ 11/11 通过

## 已知问题

- `/public` 下仍有 Next.js 默认 SVG 文件（不影响功能）
- `README.md` 还是默认内容
