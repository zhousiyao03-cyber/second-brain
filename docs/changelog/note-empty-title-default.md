# 2026-03-28 Note Empty Title Default

- date: 2026-03-28
- task / goal: 新建普通笔记时不再预填“无标题笔记”，改成真正空标题，只保留输入框 placeholder。
- key changes:
  - 新建普通笔记时写入空标题，不再默认持久化 `无标题笔记`。
  - 编辑页标题输入框 placeholder 改为 `新页面`，列表页的空标题兜底展示也统一为 `新页面`。
  - E2E 断言同步更新为“标题输入框初始为空，但 placeholder 为新页面”。
- files touched:
  - `src/app/(app)/notes/page.tsx`
  - `e2e/phase2.spec.ts`
  - `docs/changelog/note-empty-title-default.md`
- verification commands and results:
  - `pnpm lint` pending
  - `node --input-type=module <<'EOF' ... EOF` pending
- remaining risks or follow-up items:
  - 数据层仍允许空标题；这次只调整默认创建行为和列表展示，不涉及历史已有“无标题笔记”数据清理。
