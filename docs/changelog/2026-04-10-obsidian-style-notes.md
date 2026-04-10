# 2026-04-10 — Obsidian-Style Notes System

## Task
将扁平的 notes folder 系统改造为 Obsidian 风格的完整知识管理系统。

## Key Changes

### Layer 1 — 基础结构
- 新增 `folders` 表，支持 `parentId` 自引用实现无限嵌套
- `notes` 表新增 `folderId` FK，保留旧 `folder` 字段做兼容
- Folders tRPC router：list/create/rename/delete/move/toggleCollapse/reorder
- 树形视图侧边栏替代扁平 folder 列表
- 编辑器内 folder 选择器
- 数据迁移脚本 `scripts/migrate-folders.ts`

### Layer 2 — 交互体验
- @dnd-kit 拖拽：note 拖入 folder、droppable 高亮
- DraggableNoteCard + grip handle
- 可调宽度侧边栏（180-400px，localStorage 持久化）
- 双击 inline 重命名
- 右键上下文菜单

### Layer 3 — 双向链接
- WikiLink Tiptap mark 扩展
- `note_links` 表追踪链接关系
- 保存时自动提取链接
- 反向链接面板
- Wiki-link 自动补全 + hover 预览
- `searchByTitle` 和 `backlinks` tRPC query

### Layer 4 — 可视化
- Graph View 页面（Canvas 力导向图）
- `graphData` tRPC query
- 多面板侧边栏（Files / Search / Tags / Backlinks）

## Files Touched

### New Files (15)
- `src/server/db/schema.ts` (folders, noteLinks tables)
- `src/server/routers/folders.ts`
- `src/server/notes/link-extractor.ts`
- `src/components/notes/folder-tree.tsx`
- `src/components/notes/folder-tree-context-menu.tsx`
- `src/components/notes/dnd-tree-overlay.tsx`
- `src/components/notes/resizable-sidebar.tsx`
- `src/components/notes/notes-sidebar.tsx`
- `src/components/notes/backlinks-panel.tsx`
- `src/components/notes/graph-view-client.tsx`
- `src/components/editor/wiki-link.tsx`
- `src/components/editor/wiki-link-suggest.tsx`
- `src/components/editor/wiki-link-preview.tsx`
- `src/app/(app)/notes/graph/page.tsx`
- `scripts/migrate-folders.ts`

### Modified Files (7)
- `src/server/db/schema.ts`
- `src/server/routers/_app.ts`
- `src/server/routers/notes.ts`
- `src/components/editor/editor-extensions.ts`
- `src/components/notes/notes-page-client.tsx`
- `src/components/notes/note-editor-page-client.tsx`
- `package.json` (added @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, tsx)

## Database Changes
- Migration 0024: `folders` table + `notes.folderId` column + index
- Migration 0025: `note_links` table with source/target indexes

## Verification
- `pnpm build`: ✅ (TypeScript + Turbopack compilation passed)
- `pnpm lint`: ✅ (all new files clean; only pre-existing set-state-in-effect warning)
- DB migrations: ✅ (`pnpm db:generate && pnpm db:push`)
- Data migration script: ✅ (`tsx scripts/migrate-folders.ts` ran successfully)

## Remaining / Follow-up
- Folder-to-folder drag-and-drop (currently only note→folder)
- Wiki-link `[[` input trigger integration in editor (currently mark only, needs editor-level `[[` detection)
- Graph View performance optimization for 1000+ nodes
- Production Turso schema rollout (folders + note_links tables)
- E2E tests for folder CRUD and wiki-link flow
