# 2026-03-28 Daily Record Template Simplification

- date: 2026-03-28
- task / goal: 简化每日记录创建体验，去掉预填示例内容，并把用户可见文案从“日记”统一调整为“日报”。
- key changes:
  - `createJournalTemplate` 现在保留当天日期标题，并默认注入空白模块，不再预填任何示例内容。
  - 笔记列表页入口按钮、类型筛选和类型标签的用户可见文案统一调整为“日报”。
  - README 和 E2E 文案同步更新。
- files touched:
  - `src/lib/note-templates.ts`
  - `src/lib/note-appearance.ts`
  - `src/app/(app)/notes/page.tsx`
  - `e2e/phase2.spec.ts`
  - `README.md`
  - `docs/changelog/daily-record-template-simplification.md`
- verification commands and results:
  - `pnpm lint` -> passed
  - `node --input-type=module <<'EOF' ... EOF` -> passed，在当前本地 dev server 上登录 TEST 账号后打开日报入口，得到当天标题，且模板模块已按空白结构生成。
- remaining risks or follow-up items:
  - 内部数据枚举仍然使用 `journal`，这次只收敛用户可见文案，未做数据层迁移。
