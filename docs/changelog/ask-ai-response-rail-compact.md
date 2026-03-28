# 2026-03-28 Ask AI Response Rail Compact

- date: 2026-03-28
- task / goal: 压缩 Ask AI 回答下方的来源与后续操作区域，避免大面积空白和过重卡片。
- key changes:
  - 将回答下方的“双大卡片”改成单行轻量工具栏。
  - 来源展示改为紧凑的来源 pill，最多直接展示 3 个，多余来源汇总为 `+N 个来源`。
  - 删除 `引用来源`、`继续工作`、`切换思路`、`按当前范围重答` 这些大标题/大卡片文案。
  - 保留“保存为笔记”和“重新回答”两个动作，但改为 icon 按钮。
- files touched:
  - `src/app/(app)/ask/page.tsx`
  - `docs/changelog/ask-ai-response-rail-compact.md`
- verification commands and results:
  - `pnpm lint` -> 通过。
  - 无头浏览器真实登录本地 TEST 账号后访问 `/ask` 并发送 `hi` -> 成功看到回答，且 DOM 中存在 `button[aria-label="保存为笔记"]` 与 `button[aria-label*="重新回答"]`。
  - 同一次页面检查中，`继续工作`、`切换思路`、`按当前范围重答`、`引用来源` 未再出现在页面文本中。
- remaining risks or follow-up items:
  - 这次实际页面验证覆盖了真实回答和动作按钮，但没有在浏览器里完整模拟“4 个以上来源”的视觉堆叠；该分支主要依赖代码路径和样式收口，建议你手动看一眼多来源回答的观感。
