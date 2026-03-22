# V1 收敛变更记录

---

### Pass 1：产品收敛（2026-03-22）

**变更内容**：
- `src/components/layout/sidebar.tsx`：从 navItems 移除 Workflows 和 Learn，"Dashboard" 改为"首页"，移除未使用的 GraduationCap/Workflow import
- `src/app/page.tsx`：标题 "Dashboard" → "首页"
- `e2e/phase1.spec.ts`：断言从 "Dashboard" 改为"首页"，导航项列表移除"学习"和"工作流"
- `e2e/phase5.spec.ts`：学习模块和工作流模块测试标记 `test.describe.skip`
- `e2e/phase6.spec.ts`：Dashboard 断言改为"首页"
- 删除 `src/components/ui/.gitkeep`、`src/server/ai/.gitkeep`

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- E2E（phase1 + phase5 + phase6）：24 passed, 10 skipped

**已知遗留**：
- 无

---

### Pass 2：Bookmark 内容抓取 + AI 摘要修复（2026-03-22）

**变更内容**：
- 新增 `src/server/ai/fetch-content.ts`：URL 内容抓取模块，使用 `@mozilla/readability` + `linkedom`，Readability 提取失败降级为 strip HTML tags，fetch 超时 10s，内容截断 8000 字
- `src/server/routers/bookmarks.ts`：create procedure 增加 URL 内容抓取（同步，status 流转 pending → processed/failed），新增 update procedure（编辑 title/tags），新增 refetch procedure（重新抓取失败的 bookmark）
- `src/app/bookmarks/page.tsx`：新增搜索输入框、source 筛选（url/text）、status 展示（抓取中/抓取失败）、content 预览（前 100 字）、tags 展示、重新抓取按钮、保存中 loading 态
- `package.json`：新增依赖 `@mozilla/readability`、`linkedom`、`@types/mozilla__readability`
- `src/app/api/summarize/route.ts`：无需修改（已优先使用 bookmark.content）

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- E2E（phase3）：10 passed（收藏箱模块 5/5 全通过），2 failed（Todo 模块既有问题，与本次变更无关）

**已知遗留**：
- phase3 中 2 个 Todo 测试失败（`getByText('学习')` 匹配到隐藏的 `<option>` 元素）— 属于 Todo 模块既有问题，不在 Pass 2 范围

---

### Pass 3：Ask AI RAG 实现（2026-03-22）

**变更内容**：
- 新增 `src/server/ai/rag.ts`：RAG 检索层，query 拆词 → SQLite 内存匹配 notes.plainText + bookmarks.content/summary，返回 top 5 结果（每条截断 2000 字）
- `src/app/api/chat/route.ts`：集成 RAG 检索，构建带 `<knowledge_base>` 的 system prompt，支持跳过检索关键词（"不用搜索"等），指示 Claude 在回复末尾追加 `<!-- sources:[...] -->` 隐藏标记
- `src/app/ask/page.tsx`：input 改为 textarea（支持 Shift+Enter 换行），解析 AI 回复中的 sources 标记并渲染为可点击的引用来源列表（笔记跳 `/notes/[id]`，收藏跳 `/bookmarks`）
- `e2e/phase4.spec.ts`：更新选择器从 `input` 改为 `textarea`，适配新 placeholder

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- E2E（phase4）：8 passed

**已知遗留**：
- Claude 可能不稳定地遵循 sources 格式约定 — 前端已做容错（无标记时不展示引用区）
- SQLite LIKE 对中文检索效果有限（无分词器）— V1 可接受，V2 引入 FTS5

---

### Pass 4：Search 增强 + API 加固（2026-03-22）

**变更内容**：
- `src/server/routers/dashboard.ts`：search procedure 扩展 bookmark 搜索范围，新增 `summary` 和 `content` 字段匹配
- `src/components/search-dialog.tsx`：搜索结果关键词高亮（`HighlightText` 组件），类型图标区分
- `src/app/api/chat/route.ts`：新增 zod 输入校验（验证 messages 数组存在），非法输入返回 400
- `src/app/api/summarize/route.ts`：新增 zod 输入校验（验证 bookmarkId 为 string），非法输入返回 400
- `src/lib/utils.ts`：新增公共 `formatDate` 和 `truncateText` 函数
- `src/app/notes/page.tsx`：移除本地 `formatDate`，改用 `src/lib/utils.ts` 公共函数
- `src/app/bookmarks/page.tsx`：同上

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- E2E（phase6）：12 passed

**已知遗留**：
- 无

---

### Pass 5：UX/UI 打磨 + 暗色模式（2026-03-22）

**变更内容**：
- 新增 `src/components/ui/toast.tsx`：轻量 toast 组件（success/error/info），ToastProvider 上下文，3 秒自动消失
- `src/app/layout.tsx`：集成 ToastProvider
- `src/app/globals.css`：新增 `.dark .notion-editor` 样式覆盖（text/blockquote/code/pre/link/mark/selection）
- 暗色模式 `dark:` 类名添加到以下页面：
  - `src/app/page.tsx`（Dashboard）— 标题、统计卡片、列表区块，bookmark 卡片改为 Link 可点击跳转
  - `src/app/notes/page.tsx` — 标题、搜索/筛选、列表卡片、标签、**新增 plainText 内容预览（前 80 字）**
  - `src/app/notes/[id]/page.tsx` — 编辑器标题、metadata 面板
  - `src/app/bookmarks/page.tsx` — 标题、表单、搜索/筛选、列表卡片、标签
  - `src/app/ask/page.tsx` — 标题、消息气泡、输入框、引用来源
  - `src/components/search-dialog.tsx` — 对话框背景、输入框、结果列表
- Toast 集成到关键操作：Notes 删除、Bookmark 删除、AI 摘要成功/失败

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- 暗色模式需手动验证

**已知遗留**：
- Tiptap bubble-toolbar 和 slash-command 组件未添加暗色模式（使用频率低，V1 可接受）
- 冻结模块（todos、explore）未添加暗色模式（按计划不改）
