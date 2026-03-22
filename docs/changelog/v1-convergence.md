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
