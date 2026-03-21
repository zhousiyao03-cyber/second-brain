# Phase 5：AI 探索 + AI 工作流 + 学习模块

**完成日期**：2026-03-21

## 完成的功能

### 学习模块
1. 学习路径列表（卡片布局，进度条显示）
2. 5 个预置学习路径（数据库/后端/DevOps/AI/系统设计）一键初始化
3. 路径详情页（课程列表、进度追踪）
4. AI 生成课程（Claude 动态生成内容 + 练习题）
5. 课程详情页（内容展示、练习题折叠答案、标记完成）
6. 学习进度自动计算

### AI 探索
1. AI 分析用户笔记/收藏/待办推断兴趣方向
2. 生成个性化学习资源推荐
3. 兴趣标签展示
4. 推荐内容一键收藏到收藏箱

### 工作流模块
1. 工作流列表（创建/删除）
2. 3 个预置模板（URL 摘要/笔记整理/内容分类）
3. 工作流详情页（节点管线可视化）
4. 节点类型颜色区分（trigger/fetch/summarize/classify/tag/save）
5. 模拟运行按钮

## 新增/修改的文件

- `src/server/routers/learning.ts` — 学习模块 tRPC router
- `src/server/routers/workflows.ts` — 工作流 tRPC router
- `src/server/routers/_app.ts` — 注册新 router
- `src/app/learn/page.tsx` — 学习页面（重写）
- `src/app/explore/page.tsx` — AI 探索页面（重写）
- `src/app/workflows/page.tsx` — 工作流页面（重写）
- `src/app/api/generate-lesson/route.ts` — AI 课程生成 API
- `src/app/api/explore/route.ts` — AI 探索推荐 API
- `e2e/phase5.spec.ts` — 13 个测试用例

## 数据库变更

无（表已在 Phase 1 创建）

## 验证结果

- `pnpm build` ✅ 编译通过
- `pnpm lint` ✅ 无 ESLint 错误
- `pnpm test:e2e` ✅ 53/53 通过（Phase 1-4: 40 + Phase 5: 13）

## 已知问题

- 工作流执行引擎目前为模拟运行，未实际调用 AI
- 学习模块课程内容为纯文本展示，暂未集成 Markdown 渲染
- AI 探索和课程生成需要 ANTHROPIC_API_KEY
