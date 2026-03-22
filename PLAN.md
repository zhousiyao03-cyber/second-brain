# Second Brain — 实施计划

## Context

用户是资深前端工程师，想通过构建一个个人知识管理平台来学习全栈开发和 AI Agent 开发。目标是替代 Notion，并加入 AI 能力（摘要、RAG 问答、Agent 工作流）。项目目录：`/Users/bytedance/second-brain`

---

## 技术栈

| 层 | 选型 |
|---|------|
| 框架 | Next.js 16 (App Router) + React 19 |
| UI | Tailwind CSS v4 + shadcn/ui |
| 编辑器 | Tiptap (ProseMirror) |
| API | tRPC v11 |
| 数据库 | SQLite (better-sqlite3) + Drizzle ORM |
| 向量搜索 | orama（纯 JS 全文+向量搜索引擎，零依赖） |
| AI | 本地 OpenAI-compatible 模型服务（如 Ollama / LM Studio）+ Vercel AI SDK（可选 OpenAI fallback） |

---

## 项目结构

```
second-brain/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx            # 根布局（侧边栏+主内容）
│   │   ├── page.tsx              # 首页/仪表盘
│   │   ├── notes/                # 笔记本模块
│   │   │   ├── page.tsx          # 笔记列表
│   │   │   └── [id]/page.tsx     # 笔记编辑
│   │   ├── bookmarks/            # 收藏箱模块
│   │   │   └── page.tsx
│   │   ├── todos/                # Todo 模块
│   │   │   └── page.tsx
│   │   ├── explore/              # AI 探索模块
│   │   │   └── page.tsx
│   │   ├── ask/                  # Ask AI 模块
│   │   │   └── page.tsx
│   │   ├── workflows/            # AI 工作流模块
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── learn/                # 学习模块
│   │   │   ├── page.tsx          # 学习路径总览
│   │   │   └── [topic]/page.tsx  # 具体课程页
│   │   └── api/
│   │       └── trpc/[trpc]/route.ts
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 组件
│   │   ├── layout/
│   │   │   ├── sidebar.tsx       # 侧边栏导航
│   │   │   └── header.tsx
│   │   ├── editor/               # Tiptap 编辑器组件
│   │   │   └── tiptap-editor.tsx
│   │   ├── bookmarks/
│   │   ├── todos/
│   │   ├── chat/                 # AI 对话组件
│   │   └── workflows/            # 工作流编辑器组件
│   ├── server/
│   │   ├── db/
│   │   │   ├── index.ts          # DB 连接
│   │   │   ├── schema.ts         # Drizzle schema（所有表）
│   │   │   └── migrate.ts        # 迁移脚本
│   │   ├── routers/              # tRPC routers
│   │   │   ├── _app.ts           # 根 router
│   │   │   ├── notes.ts
│   │   │   ├── bookmarks.ts
│   │   │   ├── todos.ts
│   │   │   ├── explore.ts
│   │   │   ├── chat.ts
│   │   │   ├── workflows.ts
│   │   │   └── learn.ts
│   │   ├── trpc.ts               # tRPC 初始化
│   │   └── ai/
│   │       ├── summarize.ts      # 摘要 Agent
│   │       ├── recommend.ts      # 推荐 Agent
│   │       ├── rag.ts            # RAG 检索+问答
│   │       ├── vector-store.ts   # 向量存储（orama）
│   │       └── tutor.ts          # AI 导师（学习模块）
│   └── lib/
│       ├── trpc.ts               # tRPC 客户端
│       └── utils.ts
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── next.config.ts
└── .env.local                    # AI_PROVIDER / AI_BASE_URL / AI_MODEL
```

---

## 数据库 Schema

### notes 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| title | TEXT NOT NULL | |
| content | TEXT | JSON, Tiptap 格式 |
| plain_text | TEXT | 纯文本，用于搜索和向量化 |
| type | TEXT | 'note' / 'journal' / 'summary' |
| tags | TEXT | JSON 数组 |
| created_at | INTEGER | |
| updated_at | INTEGER | |

### bookmarks 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| url | TEXT | |
| title | TEXT | |
| content | TEXT | 原始内容 |
| summary | TEXT | AI 摘要 |
| tags | TEXT | JSON 数组 |
| source | TEXT | 'url' / 'text' / 'lark' |
| status | TEXT | 'pending' / 'processed' / 'failed' |
| created_at | INTEGER | |
| updated_at | INTEGER | |

### todos 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| title | TEXT NOT NULL | |
| description | TEXT | |
| priority | TEXT | 'low' / 'medium' / 'high' |
| status | TEXT | 'todo' / 'in_progress' / 'done' |
| category | TEXT | |
| due_date | INTEGER | |
| created_at | INTEGER | |
| updated_at | INTEGER | |

### chat_messages 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| role | TEXT | 'user' / 'assistant' |
| content | TEXT | |
| sources | TEXT | JSON, 引用的文档ID列表 |
| created_at | INTEGER | |

### workflows 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| description | TEXT | |
| nodes | TEXT | JSON, 工作流节点定义 |
| edges | TEXT | JSON, 节点连接关系 |
| status | TEXT | 'draft' / 'active' |
| created_at | INTEGER | |
| updated_at | INTEGER | |

### learning_paths 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| title | TEXT NOT NULL | |
| description | TEXT | |
| category | TEXT | 'backend' / 'database' / 'devops' / 'ai' / 'system-design' |
| lessons | TEXT | JSON, 课程列表及顺序 |
| progress | REAL DEFAULT 0 | 0-100 进度百分比 |
| created_at | INTEGER | |
| updated_at | INTEGER | |

### learning_lessons 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| path_id | TEXT FK → learning_paths | |
| title | TEXT NOT NULL | |
| content | TEXT | AI 生成的课程内容 |
| quiz | TEXT | JSON, 练习题 |
| order_index | INTEGER | |
| status | TEXT | 'locked' / 'available' / 'completed' |
| notes | TEXT | 用户学习笔记 |
| completed_at | INTEGER | |

### workflow_runs 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| workflow_id | TEXT FK → workflows | |
| status | TEXT | 'running' / 'completed' / 'failed' |
| results | TEXT | JSON, 每个节点的执行结果 |
| started_at | INTEGER | |
| completed_at | INTEGER | |

---

## 分阶段实施计划

### Phase 1：项目骨架 + 基础布局（Day 1）

**目标**：项目跑起来，有完整的导航和布局

1. `pnpm create next-app` 初始化项目
2. 安装依赖：tailwindcss, shadcn/ui, drizzle-orm, better-sqlite3, @trpc/server, @trpc/client, @trpc/next
3. 配置 Drizzle + SQLite 连接
4. 定义所有数据库 schema
5. 搭建 tRPC 基础设施（server/client）
6. 实现侧边栏布局（Dashboard/笔记/收藏/Todo/学习/AI探索/Ask AI/工作流）

**验证**：`pnpm dev` 启动，点击侧边栏各模块能切换页面

---

### Phase 2：笔记本模块（Day 2-3）

**目标**：完整的富文本笔记 CRUD

1. 安装 Tiptap：@tiptap/react, @tiptap/starter-kit, @tiptap/extension-*
2. 实现 TiptapEditor 组件（支持标题、列表、代码块、引用、图片）
3. 实现 tRPC router：notes.list / notes.get / notes.create / notes.update / notes.delete
4. 笔记列表页（搜索、筛选、按时间排序）
5. 笔记编辑页（实时自动保存）
6. 支持笔记类型：普通笔记、日记、总结
7. 标签系统

**验证**：能创建、编辑、删除笔记，富文本格式正常保存和渲染

---

### Phase 3：Todo + 收藏箱模块（Day 4-5）

**目标**：任务管理 + 收藏内容管理

**Todo**：
1. Todo CRUD（tRPC router）
2. Todo 列表（按优先级/状态/分类筛选）
3. 拖拽排序
4. 截止日期提醒

**收藏箱**：
1. 添加收藏（URL/文本/手动输入）
2. URL 自动抓取标题和内容（fetch + cheerio）
3. 收藏列表（按来源/标签筛选）
4. 收藏详情展示

**验证**：能管理 Todo，能添加 URL 并自动抓取内容

---

### Phase 4：AI 能力集成（Day 6-8）✅ DONE

**目标**：接入 AI provider，实现摘要和 RAG 问答

1. 安装 `@ai-sdk/openai`, `ai`（Vercel AI SDK）
2. 收藏箱 AI 摘要：添加收藏后自动调用 AI provider 生成摘要+标签
3. 向量化引擎（orama）
4. Ask AI 对话页面（流式输出 + RAG 检索 + 引用来源）
5. 笔记 AI 辅助：选中文本 → 续写/改写/翻译/摘要

**验证**：粘贴 URL 自动生成摘要；Ask AI 能基于知识库回答问题

---

### Phase 5：AI 探索 + AI 工作流 + 学习模块（Day 9-13）✅ DONE

**学习模块**：
1. 预置学习路径（数据库/API设计/Node.js/DevOps/系统设计/AI Agent）
2. AI 导师（本地/云端 provider 动态生成课程+练习题+答疑）
3. 学习进度追踪
4. 实战关联（关联本项目代码）

**AI 探索**：
1. 基于用户数据分析兴趣
2. AI provider tool calling 调用搜索 API
3. 推荐列表 + 一键收藏

**AI 工作流**：
1. 可视化编辑器（reactflow）
2. 预置节点类型（触发器/抓取/摘要/分类/保存）
3. 执行引擎
4. 预置模板

**验证**：学习路径可用；AI 探索能推荐资料；工作流能创建并运行

---

### Phase 6：Lark 集成 + 完善（Day 14-16）✅ DONE

1. 飞书文档 MCP 对接
2. 首页仪表盘
3. 全局搜索（Cmd+K）
4. 深色模式
5. 数据导出
6. 性能优化

---

## 关键技术决策

1. **SQLite** 而非 PostgreSQL：零配置，个人工具足够用
2. **orama** 而非 pgvector：纯 JS 实现，零外部依赖
3. **tRPC** 而非 REST：端到端类型安全
4. **Tiptap** 而非自研编辑器：成熟的 Block Editor
5. **Vercel AI SDK**：统一 AI 接口，内置流式支持
