# Learning Notebook & OSS Projects

## Date

2026-04-02

## Task / Goal

按 `docs/superpowers/plans/2026-04-02-learning-and-oss-projects.md` 落地两个新模块：

- Learning Notebook：topic -> notes -> AI assistant
- Open Source Projects：project -> notes -> tag filter

## Key Changes

- 新增 `learning_topics`、`learning_notes`、`learning_reviews`、`os_projects`、`os_project_notes` 五张表，并生成 Drizzle migration
- 新增 `learningNotebook` 和 `ossProjects` 两个 tRPC router，覆盖 topics/projects 与 notes 的 CRUD，以及学习模块的 AI review / ask 能力
- 将 `/learn` 从旧的 learning paths 页面替换为学习主题首页，并新增 topic detail 与 note editor 页面
- 新增 `/projects`、`/projects/[id]` 与项目笔记编辑页
- 新增 `/api/learn/draft`，支持根据 topic + keyword 生成 AI draft 笔记
- 侧边栏恢复 `Learn`、新增 `Projects`
- 新增 Playwright E2E：学习模块核心流程、项目模块核心流程
- 更新 `README.md`，将两个模块加入当前功能说明与目录说明

## Files Touched

- `README.md`
- `docs/changelog/learning-and-oss-projects.md`
- `drizzle/0011_young_may_parker.sql`
- `drizzle/meta/0011_snapshot.json`
- `drizzle/meta/_journal.json`
- `e2e/learning-notebook.spec.ts`
- `e2e/oss-projects.spec.ts`
- `src/app/(app)/learn/page.tsx`
- `src/app/(app)/learn/[topicId]/page.tsx`
- `src/app/(app)/learn/[topicId]/notes/[noteId]/page.tsx`
- `src/app/(app)/projects/page.tsx`
- `src/app/(app)/projects/[id]/page.tsx`
- `src/app/(app)/projects/[id]/notes/[noteId]/page.tsx`
- `src/app/api/learn/draft/route.ts`
- `src/components/editor/knowledge-note-editor.tsx`
- `src/components/layout/navigation.ts`
- `src/server/db/schema.ts`
- `src/server/routers/_app.ts`
- `src/server/routers/learning-notebook.ts`
- `src/server/routers/oss-projects.ts`

## Verification Commands And Results

- `pnpm db:generate` : passed, generated `drizzle/0011_young_may_parker.sql`
- `pnpm db:push` : passed, schema changes applied successfully
- `pnpm exec eslint 'src/app/(app)/learn/**/*.tsx' 'src/app/(app)/projects/**/*.tsx' 'src/app/api/learn/draft/route.ts' 'src/components/editor/knowledge-note-editor.tsx' 'src/server/routers/learning-notebook.ts' 'src/server/routers/oss-projects.ts' 'src/server/routers/_app.ts' 'src/server/db/schema.ts' 'src/components/layout/navigation.ts' 'e2e/learning-notebook.spec.ts' 'e2e/oss-projects.spec.ts'` : passed
- `pnpm build` : passed
- `pnpm test:e2e e2e/learning-notebook.spec.ts e2e/oss-projects.spec.ts` : passed, `2 passed`

## Remaining Risks / Follow-up

- 学习模块的 AI draft 目前会把生成内容先作为单段文本落到 Tiptap JSON 中，可用但不是精细结构化 block；后续可以把 Markdown 映射成更丰富的节点结构
- 全仓 `pnpm lint` 仍会被仓库里已有的 `focus-tracker/dist` 与 `focus-tracker/src-tauri/target` 生成产物噪声干扰，这不是本次改动引入的问题，但会继续影响全量 lint 信号
