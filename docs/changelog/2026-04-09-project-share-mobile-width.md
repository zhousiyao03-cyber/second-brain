# 2026-04-09 - Share And Editor Mobile Width

Task / goal:
- 收紧公开项目分享页、公开普通笔记页、登录后主笔记编辑页在移动端的无效留白，让页面更接近 Notion 那种窄屏下尽量铺满的阅读宽度，不再保留会压缩正文的多余边沟。

Key changes:
- 更新 `src/components/share/shared-project-note-view.tsx`：
  - 将公开项目分享页的外层容器在移动端改为更贴边的 `px-4 / pt-6 / gap-5` 文档流布局。
  - 将顶部项目信息卡和正文卡在移动端降级为透明、无阴影、无额外内边距的阅读面板；在 `sm` 及以上宽度恢复原来的卡片样式。
  - 收紧移动端标题字号与页脚间距，让正文区和顶部信息区都更接近屏幕边缘。
  - 为分享页头部和正文区域补了 `data-testid`，便于后续做稳定的布局测量。
- 更新 `src/components/share/shared-note-view.tsx`：
  - 将公开普通笔记页移动端外层容器改为 `px-4 / pt-6 / pb-16`。
  - 收紧移动端标题字号、tag 区和 footer 间距，并为正文容器补上 `data-testid`。
- 更新 `src/components/notes/note-editor-page-client.tsx` 与 `src/app/(app)/notes/[id]/loading.tsx`：
  - 将登录后主笔记编辑页的顶部栏、封面操作区、正文壳子统一改为移动端 `px-4` 起步。
  - 去掉正文内部在移动端多出来的 `px-1` 额外边沟，只在更宽屏恢复。
  - loading 骨架同步对齐，避免切页时布局跳变。

Files touched:
- `src/components/share/shared-project-note-view.tsx`
- `src/components/share/shared-note-view.tsx`
- `src/components/notes/note-editor-page-client.tsx`
- `src/app/(app)/notes/[id]/loading.tsx`
- `docs/changelog/2026-04-09-project-share-mobile-width.md`

Verification commands and results:
- `pnpm exec eslint src/components/share/shared-project-note-view.tsx src/components/share/shared-note-view.tsx src/components/notes/note-editor-page-client.tsx src/app/(app)/notes/[id]/loading.tsx`
  - ✅ 通过。
- `pnpm exec playwright test e2e/share-links.spec.ts --grep "project note share pages keep wide tables inside a mobile scroller"`
  - ⚠️ 未能作为有效验证使用；当前仓库的 Playwright 启动链路会在 `/login` 页初始化开发测试账号时触发 `SQLITE_READONLY_DBMOVED` / `attempt to write a readonly database`，导致该公开分享页用例在进入目标页面前就被环境问题拦截。
- 独立手工可执行验证：
  - 先用临时库 `data/test/share-layout-verify.db` 执行 `pnpm db:push`，再写入一条公开普通笔记、一条公开项目笔记和一条登录后主笔记数据。
  - 用该临时库启动独立 `next dev --port 3210`，随后通过 Playwright 脚本分别访问公开普通笔记页、公开项目笔记页、登录后主笔记编辑页并读取真实布局数据。
  - ✅ 页面均返回 `200`，且测得：
    - 公开普通笔记页：`viewportWidth = 390`、`scrollWidth = 390`、`articleWidth = 390`
    - 公开项目笔记页：`viewportWidth = 390`、`scrollWidth = 390`、`heroWidth = 358`、`bodyWidth = 358`、`wrapperClientWidth = 348`、`wrapperScrollWidth = 581`
    - 登录后主笔记编辑页：`viewportWidth = 390`、`scrollWidth = 390`、`shellWidth = 390`
  - 说明：
    - 三张页面本身都没有产生额外横向滚动。
    - 宽表格仍然被限制在项目分享页 `.tableWrapper` 内部横向滚动。
    - 公开普通笔记页和登录后主笔记编辑页都已经在 iPhone 13 视口下贴近满宽展示。

Remaining risks / follow-up:
- 当前仓库的 Playwright 默认启动顺序存在既有环境问题：测试用 `next dev` 进程与测试数据库文件状态不同步，公开分享页相关用例会先在登录页撞上 `SQLITE_READONLY_DBMOVED`。这不是本次布局改动引入的，但会阻碍后续自动化回归，建议单独修复 `playwright.config.ts` / `e2e/global-setup.ts` 的数据库初始化链路。
- 这次只调整了公开普通笔记页、公开项目笔记页、登录后主笔记编辑页；学习笔记编辑页和项目内编辑页还沿用各自现有的壳子宽度。
