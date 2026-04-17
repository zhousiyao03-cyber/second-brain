# 2026-03-23 - Todo And Bookmark Test Data Cleanup

Task / goal:
- 清理主库里历史遗留的测试 Todo 和收藏数据，避免列表、搜索和 Ask AI 再被这些测试内容干扰。

Key changes:
- 先检查 `PLAN.md`，确认本次操作属于 Phase 3（Todo + 收藏箱模块）的数据维护，不涉及越阶段开发。
- 盘点主库 `data/second-brain.db` 后，确认存在：
  - `87` 条 bookmarks
  - `153` 条 todos
  - `87` 条 bookmark 关联 `knowledge_chunks`
  - `93` 条 bookmark 关联 `knowledge_index_jobs`
- 通过单个 SQLite 事务直接清理主库中的：
  - 全部 `bookmarks`
  - 全部 `todos`
  - 全部 bookmark 关联 `knowledge_chunks`
  - 全部 bookmark 关联 `knowledge_index_jobs`
- 没有触碰 `data/test/` 下的隔离 E2E 数据库，也没有修改业务代码。

Files touched:
- `data/second-brain.db`（本地运行时数据，git ignored）
- `docs/changelog/todo-bookmark-test-data-cleanup.md`

Verification commands and results:
- `sqlite3 -tabs data/second-brain.db "select 'bookmarks', count(*) from bookmarks; select 'todos', count(*) from todos; select 'knowledge_chunks(bookmark)', count(*) from knowledge_chunks where source_type='bookmark'; select 'knowledge_index_jobs(bookmark)', count(*) from knowledge_index_jobs where source_type='bookmark';"`（清理前） -> ✅ 分别确认 `bookmarks = 87`、`todos = 153`、`knowledge_chunks(bookmark) = 87`、`knowledge_index_jobs(bookmark) = 93`。
- `sqlite3 data/second-brain.db <<'SQL' ... SQL` -> ✅ 删除事务执行成功，无报错。
- `sqlite3 -tabs data/second-brain.db "select 'bookmarks', count(*) from bookmarks; select 'todos', count(*) from todos; select 'knowledge_chunks(bookmark)', count(*) from knowledge_chunks where source_type='bookmark'; select 'knowledge_index_jobs(bookmark)', count(*) from knowledge_index_jobs where source_type='bookmark';"`（清理后） -> ✅ 分别确认 `bookmarks = 0`、`todos = 0`、`knowledge_chunks(bookmark) = 0`、`knowledge_index_jobs(bookmark) = 0`。

Remaining risks / follow-up:
- 本次删除直接作用于主库，且未创建清理前备份；如果其中混有你想保留的数据，只能从其他外部备份或重新录入恢复。
- 历史 `chat_messages` 如果曾引用这些收藏，其消息文本仍会保留原有对话内容，但后续知识检索已经不会再命中被删除的收藏数据。
