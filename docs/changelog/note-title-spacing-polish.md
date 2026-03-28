# 2026-03-28 Note Title Spacing Polish

- date: 2026-03-28
- task / goal: 给笔记编辑页的主标题和上方类型/标签区之间增加一点留白，避免视觉上贴得过近。
- key changes:
  - 给标题容器新增更明显的上边距，最终调整为 `mt-8`，让标题和上方标签区的分隔更自然。
- files touched:
  - `src/app/(app)/notes/[id]/page.tsx`
  - `docs/changelog/note-title-spacing-polish.md`
- verification commands and results:
  - `pnpm lint` -> passed
  - `pnpm exec playwright test e2e/phase2.spec.ts --grep '创建新笔记并跳转到编辑页'` -> passed
- remaining risks or follow-up items:
  - 这次只做静态间距微调，实际视觉效果仍建议在笔记编辑页桌面端和移动端各看一眼。
