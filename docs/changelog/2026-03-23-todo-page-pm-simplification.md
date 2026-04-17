# 2026-03-23 - Todo Page PM Simplification

Task / goal:
- 把 Todo 页面从偏展示型的视觉改版收回到更克制的日常工具页，减少装饰感，保留当前可用的 CRUD / 分组 / 编辑能力。

Key changes:
- 更新 `src/app/todos/page.tsx`：
  - 去掉带渐变氛围的 hero 区、英文标签和统计卡，改成更简洁的标题 + 状态摘要。
  - 保留快速录入、筛选、分组列表和右侧详情编辑，但统一为中性色卡片体系。
  - 收敛分组卡片的颜色和文案，只保留轻量状态区分，不再让每个分组都像一张强视觉海报。
  - 简化任务项内容，移除“查看”提示和更新时间等次要信息，默认只强调标题、分类、优先级、状态和时间。
  - 简化详情面板和空态文案，去掉 `INSPECTOR` 等展示型表达。

Files touched:
- `src/app/todos/page.tsx`
- `docs/changelog/todo-page-pm-simplification.md`

Verification commands and results:
- `source ~/.zshrc >/dev/null 2>&1; pnpm lint` -> ✅ 通过。
- `source ~/.zshrc >/dev/null 2>&1; pnpm build` -> ✅ 通过；仍有仓库既存的 `next.config.ts -> src/server/db/path.ts` NFT tracing warning，但构建成功。
- `source ~/.zshrc >/dev/null 2>&1; pnpm exec playwright test e2e/phase3.spec.ts --grep "Phase 3: Todo 模块" --reporter=line` -> ⚠️ 未完成；Playwright 配置固定在 `3100` 端口启动隔离 dev server，但当前仓库已有用户自己的 `next dev` 进程在跑，Next 检测到同目录 dev server 后拒绝再次启动。
- `source ~/.zshrc >/dev/null 2>&1; node --input-type=module <<'EOF' ... EOF` -> ✅ 通过；使用 Playwright Chromium 直连现有 `http://127.0.0.1:3000/todos`，确认页面不再出现 `TODAY FLOW` / `INSPECTOR`，并真实完成创建、选中、编辑和保存 Todo 流程（样本任务 `pm-todo-ahd5tb-edited`）。
- `sqlite3 -tabs data/second-brain.db "select title from todos where title like 'pm-todo-%' or title like 'home-today-%' order by title;"` -> ✅ 清理后为空，确认本次浏览器验证产生的测试 Todo 已从默认开发库移除。

Remaining risks / follow-up:
- 这次主要收的是视觉层级，不涉及拖拽排序、提醒通知等更重的任务管理能力。
- 右侧详情仍然是常驻侧栏形态；如果后续要继续压缩页面复杂度，可以再评估改成抽屉或弹层编辑。
