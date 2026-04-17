# 2026-03-23 - Todo 页面改成表格 / Dashboard 双视图

## Task / Goal

- 把 `/todos` 从单一卡片流改成更自然的双视图体验
- 提供更接近 Notion 的表格管理方式，同时保留按时间收口的 Dashboard 视图

## Key Changes

- 在 Todo 页面增加 `表格` 和 `Dashboard` 视图切换，默认进入表格视图
- 表格视图改为数据库式布局，支持直接在表格里修改状态和优先级
- Dashboard 视图保留按 `逾期 / 今天 / 即将到来 / 无时间 / 已完成` 分组的执行面板
- 顶部摘要区补充待处理、今天、逾期、已完成四个概览卡片
- 完成操作改成一键勾完成；详情面板只在选中任务时显示
- 更新 Todo E2E 断言，适配默认表格视图和新的完成交互

## Files Touched

- `src/app/todos/page.tsx`
- `e2e/phase3.spec.ts`

## Verification Commands And Results

- `source ~/.zshrc >/dev/null 2>&1; pnpm lint`
  - 通过
  - 仓库内仍有既有 warning：`src/app/notes/[id]/page.tsx` 使用原生 `<img>`
- `source ~/.zshrc >/dev/null 2>&1; pnpm build`
  - 通过
  - 仍有既有 Turbopack warning：`next.config.ts` 的 traced file 提示
- `source ~/.zshrc >/dev/null 2>&1; pnpm exec playwright test e2e/phase3.spec.ts --grep "Phase 3: Todo 模块" --reporter=line`
  - 失败，Playwright 的 `config.webServer` 尝试再次启动 `next dev`，但仓库已有一个用户自己的 dev server 正在运行并拒绝重复启动
- `source ~/.zshrc >/dev/null 2>&1; pnpm rebuild better-sqlite3`
  - 通过
  - 修复了本地 `better-sqlite3` 与当前 Node 版本不匹配，避免构建和 tRPC 请求返回 500
- `source ~/.zshrc >/dev/null 2>&1; PORT=3100 pnpm start`
  - 成功启动独立生产服务用于验证
- `source ~/.zshrc >/dev/null 2>&1; node <<'NODE' ... NODE`
  - 通过真实 Playwright Chromium 直连 `http://127.0.0.1:3100/todos`
  - 实测验证了表格视图加载、创建 Todo、表格内改状态、打开详情面板、标记完成、切换到 Dashboard 后在已完成分组可见
- `sqlite3 data/second-brain.db "DELETE FROM todos WHERE title LIKE 'notion-view-%'; SELECT COUNT(*) FROM todos WHERE title LIKE 'notion-view-%';"`
  - 通过，验证用 Todo 已清理，剩余 `0`

## Remaining Risks / Follow-up

- 官方 Playwright 仍被现有 `next dev` 进程阻塞；如果后续要恢复这条验证路径，需要调整 Playwright `webServer` 策略或先停掉已有 dev server
- 表格视图目前支持直接改状态和优先级，分类和截止时间仍需在详情面板里补充
