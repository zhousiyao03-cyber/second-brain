# 2026-03-28 Ask AI Composer Background Trim

- date: 2026-03-28
- task / goal: 精简 Ask AI 底部输入区视觉，去掉外层大面积白色渐变底、移除顶部 header，并把输入框高度压缩到更紧凑的尺寸。
- key changes:
  - 移除了 Ask AI composer 外层 sticky 容器的白色/深色渐变背景类。
  - 删除了页面顶部的 `Ask AI / Greeting` header 文案区。
  - 把输入框起始高度从较高的多行态收紧为 2 行，减小空白占用。
  - 将“清空对话”按钮移入输入区操作行，避免随 header 删除而丢失。
  - 去掉空状态里“当前模式是…”这类多余模式提示，减少页面噪音。
  - 保留输入表单卡片本身的背景、边框和阴影，不影响输入区可读性。
- files touched:
  - `src/app/(app)/ask/page.tsx`
  - `docs/changelog/ask-ai-composer-background-trim.md`
- verification commands and results:
  - `pnpm lint` pending
- remaining risks or follow-up items:
  - 如果后续发现消息列表滚动到输入区附近时层次感不够，可以再用更轻的阴影或边框补，而不是恢复整块渐变底。
