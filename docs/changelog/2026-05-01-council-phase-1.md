# Council — Multi-Agent Discussion Room (Phase 1)

**Date**: 2026-05-01

## 任务 / 目标

在 Knosi 上加一个新模块 `/council`，跑通 multi-agent 群聊的最小可用版本。
核心目标是积累 multi-agent 工程经验：
1. 去中心化 turn-taking 状态机（cheap classifier + priority queue + 重 classify）
2. 可中断的 agent stream（AbortController + SSE 屏障，端到端透传）
3. Per-persona 的 RAG scope 隔离（在现有 hybrid RAG 上加 source/tag 过滤）
4. 多层 stop condition 优先级处理（hard_limit / consecutive_no / user_interrupt / wall_clock / single-agent error）

## 关键变更

### 数据库
- 新增 4 张表：`council_personas` / `council_channels` / `council_channel_personas` / `council_channel_messages`
- 两张顶级表带 `users(id)` FK + cascade delete（review 时补加）
- 4 个索引：`council_personas_user_idx` / `council_channels_user_idx` / `council_messages_channel_idx` (composite) / `council_messages_turn_idx`

### 后端
- `src/server/council/types.ts` — Persona / Channel / SSEEvent / ClassifierDecision / ScopeKind
- `src/server/council/seeds.ts` — 3 个预置 persona（AI 工程师 / 后端架构师 / 产品经理）+ idempotent `ensureDefaultCouncilChannel`
- `src/server/council/persona-rag.ts` — applyTagFilter（纯函数）/ enrichWithTags / searchKnowledgeForPersona（fail-soft）
- `src/server/council/classifier.ts` — buildClassifierPrompt + classifyShouldSpeak（zod 校验 + 错误降级 + abort 透传）
- `src/server/council/persona-stream.ts` — streamPersonaResponse + buildPersonaPrompt（RAG 上下文 + 历史窗口 + style hint）
- `src/server/council/orchestrator.ts` — runTurn 异步生成器（核心状态机：persist → classify → top-priority → stream → persist → loop；abort 一路透传；单 agent 错误隔离；90s wall-clock 兜底）
- `src/server/council/test-mode.ts` — `COUNCIL_TEST_MODE=true` 时 classifier/stream 短路到 deterministic fixture
- `src/server/ai/provider/ai-sdk.ts` — 新增公开 `streamPlainTextAiSdk`（async iterable<string>），导出 `AiSdkMode`
- `src/server/ai/provider/index.ts` — 重新导出 `streamPlainTextAiSdk` 和 `AiSdkMode`
- `src/server/routers/council.ts` — tRPC router（ensureDefaultChannel mutation + getChannel query + listMessages query，全部 protectedProcedure，listMessages limit 上限 500）
- `src/app/api/council/[channelId]/chat/route.ts` — SSE endpoint（zod body 校验，content max 4000，messageId UUID）

### 前端
- `src/app/(app)/council/page.tsx` — 入口 redirect 到默认频道
- `src/app/(app)/council/[channelId]/page.tsx` — 服务端 wrapper（拉 channel + personas + 200 历史消息）
- `src/app/(app)/council/[channelId]/use-council-stream.ts` — hook：单 AbortController + flush 屏障，单 SSE 连接 delta 路由，stopped reason 中文化
- `src/app/(app)/council/[channelId]/council-room.tsx` — 群聊 UI：始终可用输入框（streaming 中也能 send，自动 abort 旧轮）+ Stop 按钮 + 4 色 persona 调色板 + 流式光标 + interrupted 灰化

### Sidebar
- `src/components/layout/navigation.ts` — CAPTURE 组新增 Council（Users 图标）

### 单元测试
- `src/server/council/__tests__/persona-rag.test.ts`：5 cases（empty / single / multi-tag OR / case-insensitive / no-match）
- `src/server/council/__tests__/classifier.test.ts`：4 cases（prompt shape / happy path / error fallback / abort propagation）
- `src/server/council/__tests__/orchestrator.test.ts`：6 cases（consecutive_no / hard_limit / priority order / user_interrupt / classifier-throws-fallback / single-agent stream error isolation）
- 总计 15 个新单测，全部通过

### Spec 阶段修订
1. **终止条件简化**：原 plan 的 `hard limit + 连续 M 个 no 取较小` 在 reclassify 上下文不变化的情况下与"全员 no = 立即终止"等价。简化掉冗余的 `consecutiveNoToStop` 字段，仅保留 hardLimitPerTurn。
2. **scope 缩减**：现有 hybrid RAG 索引器只识别 `note` / `bookmark` 两种 source type。Phase 1 的 `scopeKind` 从原计划的 4 种缩减为 `all` / `notes` / `bookmarks`，把 `learning-notebook` / `oss-project` 推到 Phase 3（伴随 RAG 索引器扩展）。
3. **streamChatResponse 不可用**：现有 `streamChatResponse` 返回 HTTP `Response`（UI message stream 协议），不能直接喂给 async generator。新增 `streamPlainTextAiSdk` 公开导出供 council 使用。代价：跳过 codex/claude-daemon 路由——若用户设了那两个 mode，council fallback 到 openai/local。

### 已知 Phase 1 限制（写到 spec §13）
- Classifier 仍走主模型（provider 抽象未支持 `modelHint: "cheap"`），Phase 2 优化
- 仅支持 `all` / `notes` / `bookmarks` scope，learning-notebook / oss-project 推迟
- chunks 表无冗余 tags，tag 过滤当前 join 回 source 表（数据量小可接受，量大需冗余）
- 单频道 ≤ 3 agent（schema 不写死，UI 限制）
- 第一版只暴露默认频道，channel/persona CRUD UI 推到 Phase 2
- Wall-clock 90s guard 不能打断 mid-stream（仅 between-iteration 检查），Phase 2 用内部 AbortController 串联
- 不做"沉淀为笔记"按钮（Phase 2）

## 文件

```
新增：
  drizzle/0042_salty_nomad.sql
  drizzle/0043_uneven_network.sql
  drizzle/meta/0042_snapshot.json
  drizzle/meta/0043_snapshot.json
  src/server/db/schema/council.ts
  src/server/council/types.ts
  src/server/council/seeds.ts
  src/server/council/persona-rag.ts
  src/server/council/classifier.ts
  src/server/council/persona-stream.ts
  src/server/council/orchestrator.ts
  src/server/council/test-mode.ts
  src/server/council/__tests__/persona-rag.test.ts
  src/server/council/__tests__/classifier.test.ts
  src/server/council/__tests__/orchestrator.test.ts
  src/server/routers/council.ts
  src/app/api/council/[channelId]/chat/route.ts
  src/app/(app)/council/page.tsx
  src/app/(app)/council/[channelId]/page.tsx
  src/app/(app)/council/[channelId]/use-council-stream.ts
  src/app/(app)/council/[channelId]/council-room.tsx
  scripts/db/apply-2026-05-01-council-rollout.mjs

修改：
  drizzle/meta/_journal.json
  src/server/db/schema/index.ts (export * from "./council")
  src/server/routers/_app.ts (register councilRouter)
  src/components/layout/navigation.ts (add Council to CAPTURE group)
  src/server/ai/provider/ai-sdk.ts (export streamPlainTextAiSdk + AiSdkMode)
  src/server/ai/provider/index.ts (re-export)
```

## 验证

- `pnpm build`: ✅
- `pnpm vitest run src/server/council/__tests__/`: ✅ 15/15 passed
- `pnpm lint`: ✅ 源码无新 lint 错误（仓库既有的 `.next-e2e/` build artifact 警告不计）
- E2E：本期跳过（用户决定，体感测试为主）

## 生产 schema rollout

执行了 `node scripts/db/apply-2026-05-01-council-rollout.mjs`，输出：

```
Production Turso rollout — council Phase 1
Target: libsql://database-bisque-ladder-vercel-icfg-...
Creating council_personas...
Creating council_channels...
Creating council_channel_personas...
Creating council_channel_messages...

Verification:
  OK — table council_personas exists
  OK — table council_channels exists
  OK — table council_channel_personas exists
  OK — table council_channel_messages exists
  OK — index council_personas_user_idx exists
  OK — index council_channels_user_idx exists
  OK — index council_messages_channel_idx exists
  OK — index council_messages_turn_idx exists
  OK — council_personas.user_id → users(id) ON DELETE CASCADE
  OK — council_channels.user_id → users(id) ON DELETE CASCADE

✅ Production rollout verified: council Phase 1 schema is ready.
```

## 风险 / 后续

1. **Persona prompt 调优**：3 个预置 persona 的 systemPrompt 区分度需要在真实使用中迭代。如发现讨论太"和谐"或抢话，调 classifier prompt 里的"反抢话"规则。
2. **Token 成本**：单 turn 估算 $0.02-0.05（hard_limit=6，3 persona × 多次 classify + 多次主模型 stream）。Phase 2 优化方向：local classifier + prompt cache。
3. **冷启动用户**：新用户没匹配 tag 时 RAG 退化为 `all`，3 个 agent 看的知识完全一样，差异度受损。
4. **永久 channel 历史增长**：truncate 策略简单（最近 20 条 + 早期 user 消息），长期使用后早期对话丢失。Phase 2 加 summarization。
5. **Phase 2 路线**：channel/persona CRUD UI、沉淀为笔记、tag-on-chunks 索引优化、wall-clock 内部 AbortController、cheap-model classifier 通道、`learning-notebook` / `oss-project` scope 扩展（伴随 RAG 索引器扩展）。
