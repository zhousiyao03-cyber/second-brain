# 2026-03-28 Ask AI Bottom Rail And Scope Prune

- date: 2026-03-28
- task / goal: 收紧 Ask AI 底部输入区的视觉收口，并移除“只看收藏”来源范围。
- key changes:
  - Ask AI 输入区底部改为带背景遮罩的 sticky rail，不再露出下方回答内容。
  - 在输入区下方补了一行轻提示：`AI 可能会犯错，请核对关键信息。`
  - Ask AI 页面可见的来源范围从 4 个收缩为 3 个，只保留 `全部来源`、`只看笔记`、`直接回答`。
  - 更新 Ask AI 的 E2E 断言，确认页面不再展示 `只看收藏`。
- files touched:
  - `src/app/(app)/ask/page.tsx`
  - `e2e/phase4.spec.ts`
  - `docs/changelog/ask-ai-bottom-rail-and-scope-prune.md`
- verification commands and results:
  - `pnpm lint` -> 通过。
  - 无头浏览器真实登录本地 TEST 账号后访问 `/ask` 并发送 `hi` -> 页面底部出现 `AI 可能会犯错，请核对关键信息。`
  - 同一次页面检查里，scope 只剩 `全部来源`、`只看笔记`、`直接回答`，`只看收藏` 未再出现。
- remaining risks or follow-up items:
  - 这次验证确认了底部 rail 的收口和 scope 精简，但没有做像素级视觉回归；建议你在本地桌面端再看一眼实际观感。
