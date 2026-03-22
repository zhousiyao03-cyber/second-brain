# Second Brain V1 收敛计划

> 生成日期：2026-03-22 | 修订：2026-03-22 v3
> 用途：指导后续 Claude Code 连续执行，完成 V1 收敛

---

## 1. V1 目标

将当前 6 Phase 原型收敛为一个**可日常使用的个人 AI 知识管理工具**。核心价值主张：

> 把信息（笔记、URL、文本片段）存进来 → AI 自动理解 → 随时搜索和问答

V1 不追求功能多，追求**核心路径跑通、质量可靠、体验完整**。

---

## 2. V1 范围

### 2.1 V1 活跃模块

| 模块 | 定位 | 当前状态 |
|------|------|---------|
| Notes | 核心输入 — 富文本笔记 CRUD + 自动保存 | 基本完成，需打磨 |
| Bookmarks | 核心输入 — URL/文本收藏 + AI 摘要 | 功能薄弱，需补全 |
| Search | 核心召回 — Cmd+K 全局搜索 | 最低可用，需增强 |
| Ask AI | 核心智能 — 基于知识库的 AI 问答 | **RAG 完全未实现，是最大缺口** |
| Dashboard | 入口 — 统计 + 最近条目 | 可用，小修 |

### 2.2 V1 冻结模块（保留代码和导航入口，不改功能）

| 模块 | 处理方式 | 原因 |
|------|---------|------|
| Todos | 保留导航入口，冻结功能 | 已完成 CRUD，不影响核心路径，暂不投入 |
| Explore | 保留导航入口，冻结功能 | 概念验证性质，V1 不需要 |

### 2.3 V1 隐藏模块（保留代码，从导航移除）

| 模块 | 处理方式 | 原因 |
|------|---------|------|
| Workflows | 从 sidebar navItems 移除 | 执行引擎是假的（setTimeout 2s），对用户无价值 |
| Learn | 从 sidebar navItems 移除 | 偏离知识管理核心定位 |

### 2.4 相关代码清单

冻结/隐藏模块的代码**不删除**，仅从导航入口移除。涉及文件：

- 隐藏：`src/components/layout/sidebar.tsx` — 从 `navItems` 数组移除 Workflows 和 Learn
- 冻结代码（不动）：
  - `src/app/workflows/page.tsx`, `src/server/routers/workflows.ts`
  - `src/app/learn/page.tsx`, `src/server/routers/learning.ts`, `src/app/api/generate-lesson/route.ts`
  - `src/app/todos/page.tsx`, `src/server/routers/todos.ts`
  - `src/app/explore/page.tsx`, `src/app/api/explore/route.ts`
  - DB schema 中的 `workflows`, `workflowRuns`, `learningPaths`, `learningLessons` 表保留

---

## 3. 核心用户路径

### 路径 A：笔记 → 搜索 → 问答

```
用户写笔记（/notes/[id]，Tiptap 编辑器）
  → 自动保存 title + content(JSON) + plainText
  → Cmd+K 搜索笔记标题/正文
  → Ask AI 基于所有笔记内容回答问题（RAG）
```

**当前断裂点**：Ask AI 不检索任何知识库数据，只是 Claude proxy。

### 路径 B：收藏 → 摘要 → 入库 → 搜索/问答

```
用户添加 URL（/bookmarks）
  → 自动抓取 URL 页面正文 → 存入 bookmark.content
  → 点击 AI 摘要 → 基于 content 生成 summary + tags
  → Cmd+K 搜索 bookmark 标题/摘要/正文
  → Ask AI 基于所有 bookmark 内容回答问题（RAG）
```

**当前断裂点**：
1. 没有 URL 内容抓取 — bookmark.content 始终为空
2. AI 摘要基于 title/url 字符串做摘要 — 无意义
3. 搜索不覆盖 bookmark.summary 和 bookmark.content
4. Ask AI 不检索 bookmark 数据

---

## 4. 现有技术债概览

| 类别 | 具体问题 | 位置 | 严重性 |
|------|---------|------|--------|
| 核心功能缺失 | Ask AI 无 RAG，只是 Claude proxy | `src/app/api/chat/route.ts` | **P0** |
| 核心功能缺失 | Bookmark 不抓取 URL 内容 | `bookmarks/page.tsx`, `api/summarize/` | **P0** |
| 体验不完整 | 暗色模式只覆盖 sidebar，内容区 hardcode 白色 | 所有页面组件 | P1 |
| 架构不一致 | AI 逻辑散落在 4 个 `/api/` route，`src/server/ai/` 为空 | API routes | P1 |
| 架构不一致 | Summarize 是 REST API，其他 CRUD 是 tRPC | `api/summarize/route.ts` | P1 |
| 代码重复 | `formatDate()` 在 notes 和 bookmarks 页重复定义 | 两个 page.tsx | P1 |
| 输入校验缺失 | chat/summarize API 无 zod 校验 | 2 个 API route | P1 |
| 功能缺失 | Bookmark 无搜索/筛选/编辑 | `bookmarks/page.tsx` | P1 |
| 功能缺失 | Search 不覆盖 bookmark.summary/content | `dashboardRouter.search` | P1 |
| 功能缺失 | Chat 记录不持久化（chat_messages 表未使用） | ask/page.tsx, chat/route.ts | P2 |
| 功能缺失 | Notes 列表无分页 | `notesRouter.list`, notes/page.tsx | P2 |
| 空文件 | `src/components/ui/.gitkeep`, `src/server/ai/.gitkeep` | — | P2 |
| UI 粗糙 | 无 toast/notification，全用 confirm() | 多处 | P2 |
| UI 粗糙 | 无 loading skeleton | 所有列表页 | P2 |
| 术语不统一 | Dashboard 标题英文，其他中文 | `src/app/page.tsx` | P2 |

---

## 5. V1 收敛 Pass 规划

共 6 个 Pass，按依赖顺序执行。

### 验证策略

- **每个 Pass 必须**：`pnpm build && pnpm lint`
- **每个 Pass 必须**：运行与改动相关的 E2E 测试（如 `pnpm test:e2e -- phase3.spec.ts`）
- **Pass 6（最终收口）**：运行全量 `pnpm test:e2e`

---

### Pass 1：产品收敛

**目标**：收缩产品边界 — 隐藏噪音模块，让导航聚焦 V1 核心功能。

**范围**：
- `src/components/layout/sidebar.tsx`：从 `navItems` 数组移除 Workflows (`/workflows`) 和 Learn (`/learn`)
- `src/app/page.tsx`：Dashboard 标题从 "Dashboard" 改为"首页"
- 修复因导航变化可能导致的 E2E 测试失败（`e2e/phase5.spec.ts` 中 workflows/learn 的 sidebar 导航断言）：标记为 skip 或调整选择器
- 顺手杂项：清理空占位文件 `src/components/ui/.gitkeep`、`src/server/ai/.gitkeep`（如果存在）

**不做**：不动冻结模块代码，不改路由（直接访问 `/workflows`、`/learn` 仍可用），不动 schema，不动 API 逻辑，不做暗色模式。

**完成定义**：
1. Sidebar 展示 6 项：首页、笔记、收藏、Todo、AI 探索、Ask AI
2. 直接访问 `/workflows`、`/learn` 仍然可用
3. 相关 E2E 测试通过或已标记 skip

**产出物**：
- 修改后的 `src/components/layout/sidebar.tsx`
- 修改后的 `src/app/page.tsx`
- 调整后的 `e2e/phase5.spec.ts`

**风险点**：
- phase5 E2E 中可能有 workflows/learn 的深度测试（不仅是导航），需逐条审查决定 skip 还是调整

**自动验证**：
```bash
pnpm build
pnpm lint
pnpm test:e2e -- phase1.spec.ts phase5.spec.ts phase6.spec.ts
```

---

### Pass 2：Bookmark 内容抓取 + AI 摘要修复

**目标**：让路径 B 的前半段跑通 — 保存 URL 时获取可摘要的文本内容，AI 摘要基于真实内容。

**范围**：

**内容抓取方案**（稳健优先，不追求完美正文提取）：

新增 `src/server/ai/fetch-content.ts`，封装 URL 内容抓取逻辑：
- 优先尝试 Readability 算法（使用 `@mozilla/readability` + `linkedom`）— Firefox 阅读模式核心库，成熟可靠
- 如果 Readability 提取失败或内容过短（< 50 字），降级为全文去标签（strip HTML tags）
- 如果 fetch 本身失败（网络错误、超时、非 HTML 响应），不阻塞 bookmark 创建，content 留空，status 设为 `"failed"`
- fetch 超时设为 10 秒
- 内容截断到 **8000 字**
- 返回 `{ title: string | null, content: string | null, success: boolean }`

**8000 字截断的 tradeoff**：
- 收益：覆盖绝大多数文章全文（典型博客 2000-5000 字），足够做摘要和关键词搜索，避免 SQLite 单行过大影响查询性能
- 代价：超长文档（论文、文档站聚合页）会截断丢失尾部内容，RAG 检索可能漏掉尾部信息
- 选择理由：V1 个人工具场景下 8000 字覆盖 95%+ 场景，SQLite 无 blob 压缩，过大内容会显著膨胀 DB 文件。后续可按需调大或改为分块存储

**Bookmark 创建 → 抓取 → 状态流转**：

```
用户点击"保存" (source=url)
  → bookmarks.create 同步执行：
      1. 立即写入 DB，status="pending"，返回 bookmark id 给前端
      2. 在同一请求中调用 fetchContent(url)
      3. 成功 → 更新 content + title(如用户未填) + status="processed"
      4. 失败 → content 留空，status="failed"
  → 前端 mutation onSuccess 后 invalidate 列表，UI 自然刷新展示最新 status

用户点击"重新抓取" (status=failed 的 bookmark)
  → bookmarks.refetch 执行同样的 fetchContent 逻辑
  → 成功 → status="processed"，失败 → 保持 "failed"
```

注意：抓取在 tRPC procedure 内同步完成（受 fetch 10s 超时保护），不引入后台任务队列。这意味着 create 请求最多阻塞 ~10s。V1 可接受，V2 如需优化可改为异步。

**UI 状态感知** — `src/app/bookmarks/page.tsx`：
- `status="pending"`：显示灰色"抓取中"标签（实际上 V1 同步抓取不会持续展示此状态，但保留语义完整性）
- `status="processed"`：正常展示，卡片展示 content 预览（前 100 字）
- `status="failed"`：显示橙色"抓取失败"标签 + "重新抓取"按钮
- 添加搜索输入框（对标 notes 页）
- 添加 source 筛选（url / text）

**Router 变更** — `src/server/routers/bookmarks.ts`：
- `create` procedure：增加 URL 内容抓取（如上流转）
- 新增 `update` procedure（更新 title、tags）
- 新增 `refetch` procedure（重新抓取指定 bookmark 的 URL 内容）

**摘要修复** — `src/app/api/summarize/route.ts`：
- AI 摘要优先使用 `bookmark.content`（非空时），`bookmark.url` 仅作为 fallback

**允许引入的依赖**：
- `@mozilla/readability`：Mozilla 官方维护的正文提取库
- `linkedom`：轻量 DOM 解析器（比 jsdom 小得多）

**不做**：不做 orama 向量搜索，不动 Ask AI，不做 bookmark 详情页，不引入后台任务队列。

**完成定义**：
1. 创建 URL bookmark 时自动抓取内容并存入 content 字段
2. status 流转正确：pending → processed/failed
3. 抓取失败不阻塞创建，UI 展示失败状态，可手动重试
4. AI 摘要基于抓取到的正文生成
5. Bookmark 列表可搜索、可按 source 筛选

**产出物**：
- 新文件 `src/server/ai/fetch-content.ts`
- 修改 `src/server/routers/bookmarks.ts`（create 改造 + update/refetch 新增）
- 修改 `src/app/api/summarize/route.ts`
- 修改 `src/app/bookmarks/page.tsx`（搜索/筛选/状态展示）

**风险点**：
- 部分 URL 可能因 CORS、anti-bot、登录墙导致 fetch 失败 — 已有 failed 状态兜底
- tRPC procedure 内同步 fetch 最多阻塞 10s — V1 可接受，前端 mutation 有 loading 态
- `@mozilla/readability` 对非文章页面（SPA、动态加载）提取效果差 — 降级为 strip tags 保底

**自动验证**：
```bash
pnpm build
pnpm lint
pnpm test:e2e -- phase3.spec.ts
# 手动验证：添加一个真实 URL（如 GitHub README），检查 content 非空，摘要有意义
```

---

### Pass 3：Ask AI RAG 实现

**目标**：让路径 A 和路径 B 的后半段跑通 — Ask AI 能检索知识库回答问题。

**范围**：

**RAG 检索层** — 新增 `src/server/ai/rag.ts`：

- `retrieveContext(query: string): Promise<RetrievalResult[]>` 函数
- 检索数据源：`notes.plainText` + `bookmarks.content` + `bookmarks.summary`
- 检索方式：将 query 拆词（按空格/标点分词），对每个词用 SQLite `LIKE %词%` 匹配，结果按命中词数排序
- **检索结果上限**：最多返回 **5 条**
- **每条上下文长度上限**：截断到 **2000 字**（5 × 2000 = 最多 10000 字注入 prompt）
- 统一 source schema：
  ```typescript
  interface RetrievalResult {
    id: string;
    type: "note" | "bookmark";
    title: string;
    content: string;    // 截断后的内容片段
    matchScore: number; // 命中词数
  }
  ```

**空检索 + 降级策略**：
- 检索结果为空时（无命中或知识库为空）：**不注入 context 块**，system prompt 切换为通用助手模式，AI 正常回答
- 检索结果非空时：system prompt 中注入 `<knowledge_base>` 块，指示 AI 优先基于知识库回答，并引用来源
- 用户消息中明确包含"不用搜索"/"直接回答"等意图时，跳过检索（简单关键词匹配即可）

**Sources 传递方案**（固定方案，不做二选一）：

采用 **AI 回复内容尾部追加 JSON 块** 的方式传递引用来源：
- Chat API 在 system prompt 中指示 Claude：如果使用了知识库内容，在回复末尾追加 `<!-- sources:[ {"id":"...","type":"...","title":"..."} ] -->` 格式的隐藏标记
- 前端解析 AI 回复文本，用正则提取 `<!-- sources:...-->` 块，解析为 source 列表后从显示文本中移除
- 渲染引用来源列表在回复下方（笔记/bookmark 标题，可点击跳转到 `/notes/[id]` 或 `/bookmarks`）

选择理由：Vercel AI SDK v6 的 `useChat` + `TextStreamChatTransport` 不方便在 stream 中注入自定义 metadata。内容内嵌方案无需改动 transport 层，前端只需解析文本，实现最简单。

**Chat API** — `src/app/api/chat/route.ts`：
- 取最新 user message 调用 `retrieveContext()` 获取上下文
- 将检索到的内容和 source 信息拼接到 system prompt 中

**Ask AI 页面** — `src/app/ask/page.tsx`：
- 输入框改为 textarea 支持多行
- 解析 AI 回复中的 sources 标记，渲染为可点击的引用来源列表

**不做**：
- 不实现向量嵌入/语义搜索（V2 再做）
- 不引入 orama
- 不做多轮对话上下文窗口管理（直接传全部历史给 Claude）
- 不做聊天持久化（`chat_messages` 表暂不使用 — 刷新丢失 V1 可接受）

**完成定义**：
1. 用户提问时，AI 回复内容基于知识库中的笔记和收藏
2. 回复下方显示引用来源，可点击跳转
3. 知识库为空时 AI 仍可正常回答（降级为普通对话）
4. 不携带知识库上下文的普通对话也能正常工作

**产出物**：
- 新文件 `src/server/ai/rag.ts`
- 修改 `src/app/api/chat/route.ts`
- 修改 `src/app/ask/page.tsx`

**风险点**：
- SQLite LIKE 分词检索对中文效果有限（无分词器），可能漏召回 — V1 可接受，V2 引入 FTS5 或向量搜索
- Claude 可能不稳定地遵循 sources 格式约定 — 需在 system prompt 中强调格式，前端做容错解析（无 sources 标记时不展示引用区）
- 5 条 × 2000 字 = 10000 字注入 prompt，加上历史消息可能接近 context 上限 — 当前个人工具消息量不大，V1 可接受

**自动验证**：
```bash
pnpm build
pnpm lint
pnpm test:e2e -- phase4.spec.ts
```

---

### Pass 4：Search 增强 + API 加固

**目标**：搜索覆盖全部 V1 内容类型，V1 活跃模块的 API 层输入校验完善。

**范围**：
- `src/server/routers/dashboard.ts` 的 `search` procedure：
  - 搜索范围扩展：bookmark 增加搜索 `summary` 和 `content` 字段
  - 返回匹配片段预览（匹配行前后 50 字）
- `src/components/search-dialog.tsx`：
  - 搜索结果高亮匹配关键词
  - 添加搜索结果类型图标区分
- V1 活跃模块的 API 输入校验（不动冻结模块）：
  - `src/app/api/chat/route.ts`：用 zod 校验 `{ messages: z.array(...) }`
  - `src/app/api/summarize/route.ts`：用 zod 校验 `{ bookmarkId: z.string() }`
- 提取公共工具函数到 `src/lib/utils.ts`：
  - `formatDate(date: Date | null): string`
  - `truncateText(text: string, maxLength: number): string`
- Notes 和 Bookmarks 页面改用提取后的公共函数

**不做**：不做 FTS5 全文搜索，不做搜索排序优化，不改 schema，不动冻结模块的 API（`explore/route.ts` 等）。

**完成定义**：
1. Cmd+K 搜索能搜到 bookmark 的 summary 和 content
2. 搜索结果关键词高亮
3. chat 和 summarize API 有输入校验，非法输入返回 400
4. `formatDate` 只存在于 `src/lib/utils.ts` 一处

**产出物**：
- 修改 `src/server/routers/dashboard.ts`
- 修改 `src/components/search-dialog.tsx`
- 修改 `src/app/api/chat/route.ts`、`src/app/api/summarize/route.ts`
- 修改 `src/lib/utils.ts`
- 修改 `src/app/notes/page.tsx`、`src/app/bookmarks/page.tsx`（改用公共函数）

**风险点**：
- bookmark.content 可能很长（8000 字），LIKE 搜索全文可能慢 — SQLite 单用户场景下可接受，数据量大时需 FTS5
- 高亮实现可能与 HTML 转义冲突 — 搜索结果是纯文本，直接字符串匹配即可

**自动验证**：
```bash
pnpm build
pnpm lint
pnpm test:e2e -- phase6.spec.ts
```

---

### Pass 5：UX / UI 打磨 + 暗色模式

**目标**：V1 活跃模块的暗色模式可用，补齐关键操作的 UI 反馈机制。

**范围**：

**暗色模式**（仅覆盖 V1 活跃模块）：
- 以下组件添加 `dark:` 类名：
  - `src/app/page.tsx`
  - `src/app/notes/page.tsx`, `src/app/notes/[id]/page.tsx`
  - `src/app/bookmarks/page.tsx`
  - `src/app/ask/page.tsx`
  - `src/components/search-dialog.tsx`
  - `src/components/editor/tiptap-editor.tsx`, `bubble-toolbar.tsx`, `slash-command.tsx`
- 不改冻结模块（todos、explore）— 用户可接受这两个页面暗色模式不完美

**UI 反馈机制**：
- 新增 `src/components/ui/toast.tsx`：轻量 toast 组件（成功/失败/info）
- 在关键操作场景接入 toast：Notes 删除、Bookmark 创建/删除/摘要成功/失败、Ask AI 错误

**小修补**：
- Notes 列表增加内容预览（plainText 前 80 字）
- Dashboard bookmark 卡片添加链接跳转

**不做**：不加 loading skeleton，不做 Notes 分页，不重构组件结构，不碰冻结模块。

**完成定义**：
1. V1 活跃页面在暗色模式下背景/文字/边框颜色正确，无白色刺眼块
2. 关键操作有 toast 反馈
3. Notes 列表有内容预览

**产出物**：
- 新文件 `src/components/ui/toast.tsx`
- 修改所有 V1 活跃页面组件（dark: 类名）
- 修改 `src/app/notes/page.tsx`（内容预览）
- 修改 `src/app/page.tsx`（bookmark 卡片链接）

**风险点**：
- Tiptap 编辑器内部样式可能需要额外 CSS 覆盖（ProseMirror 有自己的样式体系），dark: 类名不一定够用 — 可能需要在 `globals.css` 中增加 `.dark .ProseMirror` 规则
- toast 组件需要一个全局 context 或 DOM portal — 实现尽量轻量，避免引入状态管理

**自动验证**：
```bash
pnpm build
pnpm lint
# 暗色模式需手动验证：切换暗色模式，逐页检查 V1 活跃页面
```

---

### Pass 6：E2E 收尾 + 工程文档收口

**目标**：V1 核心路径有完整 E2E 覆盖，文档反映最新状态，形成可交付的 V1。

**范围**：

**E2E 测试**：
- 新增 `e2e/v1-core-paths.spec.ts`：覆盖路径 A（笔记 → 搜索 → Ask AI）和路径 B（收藏 URL → 摘要 → 搜索）的完整流程
- 审查并修复所有既有 E2E 测试，确保全量通过
- 对已跳过/失效的 workflows/learn 相关测试标记 skip 并注释原因

**文档收口**：
- 更新 `README.md` 反映 V1 状态（功能列表、启动说明、环境变量）
- 在 `docs/changelog/` 新增 `v1-convergence.md` 记录所有 Pass 的变更汇总

**关于 PLAN.md**：不更新 `PLAN.md`。`PLAN.md` 是原始 6 Phase 开发计划的历史记录，保持原样作为"项目从哪里来"的参考。`docs/v1-plan.md`（本文档）是"项目要到哪里去"的执行计划。两者角色不同，不形成双事实源：
- `PLAN.md` = 历史归档（Phase 1-6 的原始规划，不再修改）
- `docs/v1-plan.md` = 活跃执行计划（V1 收敛的唯一事实源）

**不做**：不新增功能，不重构代码。

**完成定义**：
1. `pnpm build && pnpm lint && pnpm test:e2e` 全量通过
2. V1 核心路径 E2E 覆盖
3. README 和 changelog 文档已更新
4. `docs/changelog/v1-convergence.md` 记录完整变更

**产出物**：
- 新文件 `e2e/v1-core-paths.spec.ts`
- 修改既有 E2E 测试文件（修复/skip）
- 修改 `README.md`
- 新文件 `docs/changelog/v1-convergence.md`

**风险点**：
- V1 核心路径 E2E 涉及 AI 调用（Ask AI + Summarize），测试环境需要有效的 `ANTHROPIC_API_KEY` — 可 mock 或使用环境变量控制跳过
- 既有 66 个测试中可能有因 Pass 1-5 变更而 break 的 — 需要逐个排查修复

**自动验证**：
```bash
pnpm build
pnpm lint
pnpm test:e2e  # 全量
```

---

## 6. 执行约束

### 每个 Pass 的固定流程（必须严格遵循，不可跳过任何步骤）

```
1. 开始前：读本文档确认范围，读 CLAUDE.md 确认规范
2. 编码：只改范围内的文件
3. 验证：pnpm build && pnpm lint + 相关 E2E（见各 Pass 自动验证）
4. 留档：更新 docs/changelog/v1-convergence.md（必须，见下方留档规范）
5. 提交：git commit（必须，见下方提交规范）
```

### 留档规范（强制）

每个 Pass 完成后，**必须**在 `docs/changelog/v1-convergence.md` 中追加该 Pass 的记录，格式如下：

```markdown
### Pass N：标题（日期）

**变更内容**：
- 具体改了什么（精确到文件）

**验证结果**：
- pnpm build：✅/❌
- pnpm lint：✅/❌
- E2E（列出跑了哪些）：N passed, M skipped

**已知遗留**：
- 如有未解决问题，在此列出
```

如果 `docs/changelog/v1-convergence.md` 不存在，第一个 Pass 完成时创建。不留档 = Pass 未完成。

### 提交规范（强制）

验证通过 + 留档完成后，**必须**创建 git commit：
- commit message 格式：`v1: pass N - 简要描述`
- 确认 `git status` 中只包含本 Pass 范围内的文件变更
- 不提交 `data/*.db`、`.next/`、`node_modules/`
- 不提交 = Pass 未完成

### 不变式

- **不删除任何冻结/隐藏模块的代码**（包括 schema 表、router、页面组件）
- **不修改冻结模块的代码**（todos、explore、workflows、learn 及其对应的 API route）
- **不引入新的重型依赖**（如 orama、reactflow、jsdom）— V1 用轻量方案
- **默认不新增数据库表**。如果新增表能显著简化 V1 核心实现（如独立的 `search_index` 表），允许新增，但必须在 Pass 描述中明确说明 tradeoff（新增表的收益 vs. 复用现有表的成本）。schema 变更需跑 `pnpm db:generate && pnpm db:push`
- `@mozilla/readability` 和 `linkedom` 是 Pass 2 允许引入的唯二新依赖

### Pass 间的依赖关系

```
Pass 1（产品收敛）    → 无依赖，立即开始
Pass 2（Bookmark）    → 无依赖，可与 Pass 1 并行
Pass 3（RAG）         → 依赖 Pass 2（需要 bookmark.content 有数据）
Pass 4（Search + API）→ 依赖 Pass 2（搜索需覆盖 bookmark.content）
Pass 5（UX/UI）       → 依赖 Pass 1-4 完成
Pass 6（E2E + 文档）  → 依赖 Pass 1-5 全部完成
```

建议执行顺序：`Pass 1 → Pass 2 → Pass 3 → Pass 4 → Pass 5 → Pass 6`

---

## 7. V1 之后（Out of Scope）

以下内容明确不在 V1 范围内，留给 V1.1 或 V2：

- orama 向量搜索 / 语义搜索
- Workflow 执行引擎
- Learn 模块重新上线
- Notes 分页（当笔记超过 100 条再考虑）
- Loading skeleton
- Lark 飞书集成
- 数据导出
- 多轮对话上下文窗口管理
- 聊天记录持久化（chat_messages 表）
- 用户认证（个人工具暂不需要）
