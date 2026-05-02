# 2026-05-02 — Drifter Phase 1（AI 文字陪伴游戏）

## 任务 / 目标
按 `docs/spec` 中的 drifter 设计稿落地 Phase 1：一个轻量级 AI "文字陪伴"
体验。用户进入 `/drifter` 后，由 NPC "Pip" 在一个由 Phaser 渲染的茶馆场景
里招呼来访者，通过对话框 + hooks 推动对话；session 状态（天数、天气、
时段）持久化到 SQLite。

## 关键改动

### 数据层
- 新增 schema `src/server/db/schema/drifter.ts`：
  - `drifter_sessions`(id, user_id, day_number, weather, time_of_day, language, started_at, ended_at)
  - `drifter_messages`(id, session_id, role, content, emotion, status, hooks, created_at)
  - `drifter_memories`(id, user_id, summary, source_message_id, importance, created_at, last_referenced_at)
- 注册到 `src/server/db/schema/index.ts`
- 迁移：`drizzle/0044_eager_sleepwalker.sql` + `drizzle/meta/0044_snapshot.json`

### 服务端
- `src/server/ai/drifter.ts`（447 行）：
  - `getOrCreateActiveSession` — 复用未结束 session，否则创建新一天
  - `buildOpeningLine` / `buildFarewell` — 多语言文案生成
  - `getPipResponse` — 调用 LLM 生成 emotion + text + hooks 的 PipChunk
  - `pickWeather` / `pickTimeOfDay` — 基于种子和小时挑选场景参数
  - `detectLanguage` — 中英混合检测，根据用户消息更新 session.language
  - `TEST_MODE_DRIFTER` + `fakePipChunk` — e2e mock 模式（`DRIFTER_E2E_MOCK=1` / `DRIFTER_TEST_MODE=1`）
- `src/server/ai/drifter.test.ts` — 单元测试覆盖 detectLanguage / pickWeather / opening line
- API 路由：
  - `POST /api/drifter/session` — 启动/恢复 session，写入首条 greeting
  - `POST /api/drifter/chat` — 接收用户消息、保存、生成 Pip 回复并入库
  - `POST /api/drifter/leave` — 标记 session ended_at

### 前端
- 页面 `src/app/(app)/drifter/`：layout / page / drifter-client.tsx
- 组件 `src/components/drifter/`：
  - `phaser-stage.tsx` — 动态加载 Phaser 4，挂载 `tea-house` 场景；失败回退到纯文本背景
  - `scenes/tea-house.ts` — 茶馆背景场景（雨/雪/雾的视觉切换）
  - `dialogue-box.tsx` — 历史消息列表 + 打字机效果
  - `input-bar.tsx` — 输入框 + hooks 快捷发送按钮
  - `hud.tsx` — 顶部展示 day/weather/time
  - `leave-button.tsx` — Step outside 返回 dashboard
- `src/lib/drifter/`：i18n、types
- 侧边栏新增 "REST" 分组，加入 Drifter（Leaf 图标），见 `src/components/layout/navigation.ts`

### E2E
- `e2e/drifter.spec.ts`：3 用例（侧边栏入口 → 招呼 → 发送，step outside，hook 按钮）
- 配置 `playwright.config.ts` 注入 `DRIFTER_E2E_MOCK=1`
- 用 `test.describe.configure({ mode: "serial" })` 强制串行 — 同一 e2e 用户多个 worker 并行会互相 leave session 引发 410

### 依赖
- `phaser ^4.1.0`（`package.json` + `pnpm-lock.yaml`）

## 文件清单
- 新增：`drizzle/0044_eager_sleepwalker.sql`、`drizzle/meta/0044_snapshot.json`、`src/server/db/schema/drifter.ts`、`src/server/ai/drifter.ts`、`src/server/ai/drifter.test.ts`、`src/app/(app)/drifter/{layout,page,drifter-client}.tsx`、`src/app/api/drifter/{session,chat,leave}/route.ts`、`src/components/drifter/{dialogue-box,hud,input-bar,leave-button,phaser-stage}.tsx`、`src/components/drifter/scenes/tea-house.ts`、`src/lib/drifter/{i18n,types}.ts`、`e2e/drifter.spec.ts`、`scripts/db/apply-2026-05-02-drifter-rollout.mjs`
- 修改：`drizzle/meta/_journal.json`、`package.json`、`pnpm-lock.yaml`、`playwright.config.ts`、`src/components/layout/navigation.ts`、`src/server/db/schema/index.ts`

## 验证
- `pnpm build` ✅（清掉 `.next-e2e/` 与 `.next-e2e-billing/` 这两个被 Next 16 类型生成器写坏的脏缓存目录后通过；它们是 e2e 跑出来的产物，下次 e2e 会自动重建）
- `pnpm lint` ✅（0 errors，14 warnings 全是仓库历史遗留，非本次引入）
- `pnpm test:e2e drifter` ✅（3/3 通过，serial 模式）
- 全套 `pnpm test:e2e` 未跑通过；首批失败用例（如 `ask-ai-editor-inline.spec.ts`）断言中文文案 `"改写选中文本"` 但源码已经是英文 `"Rewrite selection"`，是仓库历史遗留的 e2e 漂移，与 drifter 改动无关，本次不修。

## 生产 schema rollout
- 迁移 0044 添加 `drifter_sessions` / `drifter_messages` / `drifter_memories` 三张表 + 3 个索引 + 3 个 FK
- 执行：`node scripts/db/apply-2026-05-02-drifter-rollout.mjs`（凭证读 `.env.turso-prod.local`，幂等）
- 输出：3 张表、3 个索引全部 verified；`drifter_sessions.user_id → users(id) ON DELETE CASCADE`、`drifter_memories.user_id → users(id) ON DELETE CASCADE`、`drifter_messages.session_id → drifter_sessions(id) ON DELETE CASCADE` 都正确
- 收到 `✅ Production rollout verified: drifter Phase 1 schema is ready.`

## 剩余风险 / 后续
- DialogueBox 的 typewriter useEffect 依赖 `history.length`，新消息到来会清掉上一条 pip 还在播放的 timer，可能让前一条 greeting 卡在中段。E2E 没暴露（mock 文本短）但生产真实流式可能感知到 — 后续考虑改成按 message id 跟踪。
- 同一用户的 drifter 会话不能被多个 tab 并行使用（getOrCreateActiveSession 复用 active session，并发 chat 会有写冲突）；Phase 1 不处理。
- Phaser 加载失败有纯文本 fallback，但场景资源体积没分析，首屏 LCP 待观察。
- Memory 表已建但 Phase 1 未启用读写逻辑，后续 Phase 接 RAG 时再用。
