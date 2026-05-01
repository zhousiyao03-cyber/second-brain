# Council — Multi-Agent Discussion Room

**Date**: 2026-05-01
**Status**: Design (awaiting implementation plan)
**Author**: Zhou Siyao (周思尧)

---

## 0. 背景与目标

### 为什么做

Knosi 已经有相当完整的 PKM + AI 能力（Notes / Learning Notebooks / Ask AI / agentic RAG / Claude Code Daemon）。这个项目的核心目的不是"再加一个产品功能"，而是**通过实践积累 multi-agent 工程经验**——尤其是当前业界主流 agent 框架避而不谈的几个硬骨头：去中心化 turn-taking、可中断流、per-agent RAG scope 隔离、多层终止条件。

产品形态上，它落地为一个"群聊 + 多 AI 视角讨论"的功能：用户抛一个问题到频道，多个有不同人格 + 不同知识 scope 的 agent 自主决定要不要发言、互相回应、互相反驳；用户可以随时插话或停止讨论。

### 核心练手目标

1. **去中心化 turn-taking 状态机** —— 多 agent 之间谁该开口、谁该闭嘴
2. **可中断的 agent stream** —— 用户在 agent 流式输出中途插话时的状态切换
3. **Per-persona 的 RAG scope 隔离** —— 每个 agent 看自己 scope 内的知识
4. **多层 stop condition 优先级处理** —— 硬上限 / 自然冷却 / 用户中断 / 错误

### 与同类竞品的区别

- 不同于 Moxt（团队协作工作台，一人一 agent 共享记忆）：Knosi Council 是**一人多 agent**，价值在多视角碰撞而非协作
- 不同于一般"AI 圆桌"产品：每个 persona 跟 Knosi 的笔记知识库**深度绑定**（scope 隔离），这是别处复制不出来的差异化

---

## 1. 设计决策汇总

| 维度 | 决策 | 备注 |
|---|---|---|
| **形态** | 群聊（Room）形态，内核是多视角讨论 | Q2/Q3 |
| **入口** | 顶级新模块 `/council`（Sidebar 一等公民） | Q13c |
| **频道模型** | 永久 Channel（Slack/Discord 风格） | Q8 |
| **agent 上限** | 单频道 ≤ 3 个 agent（schema 不写死，UI 限制） | Q10 |
| **persona 来源** | 预置 3 个种子 + 用户自定义（CRUD 在 Phase 2） | Q7 |
| **persona 知识 scope** | 模块（`all` / `notes` / `bookmarks`）+ 可选 tag 白名单（Any 语义）。learning-notebook / oss-project 推迟到 Phase 3（见 §13） | Q11 (2) |
| **turn-taking** | 去中心化：每条消息后并发跑 cheap classifier，每个 persona 决策 should-speak + priority | Q5 |
| **节奏** | 流式异步，输入框始终可用；用户发新消息 = abort 当前流 + 新一轮 | Q9 |
| **终止** | 硬上限 N 条 兜底；全员 no 即自然结束；用户可随时手动 Stop | Q12 (1) |
| **产物** | 频道历史保留；可手动选消息"沉淀为 Knosi 笔记"（Phase 2） | Q13b |
| **技术栈** | Vercel AI SDK 自造 + 借鉴 OpenAI Swarm handoff 思路；不引 LangGraph/Mastra | Q13a |
| **MVP 分期** | Phase 1 (d1) 跑通 → Phase 2 (d2) 产品化 | Q13d |

> (1) 终止决策原始 Q12 选项 c 是 "硬上限 + 连续 M 个 no 取较小"。spec 自审时发现：reclassify 之间上下文不变化的情况下，"连续 no" 与 "全员 no" 等价（重试 classifier 输入相同，输出大概率相同）。简化为"全员 no = 立即终止"，去掉 `consecutiveNoToStop` 字段，消除冗余参数。
>
> (2) Q11 原决策包含 `learning-notebook` / `oss-project` 两个 scope。plan 阶段读现有代码发现 Knosi 的 hybrid RAG 当前只索引 `note` / `bookmark` 两类（见 `src/server/db/schema/knowledge.ts`）。扩展索引器支持 learning-notes / project-notes 的工程量大且与 multi-agent 核心目标无关，**Phase 1 缩减 scope 到 `all` / `notes` / `bookmarks`**，配合 tag 过滤已能覆盖差异化需求。learning-notebook / oss-project scope 推迟到 Phase 3（伴随 RAG 索引扩展）。

---

## 2. 预置 Persona 配方

| Name | scope | systemPrompt 关键点 |
|---|---|---|
| **AI 工程师** | `notes` + tags `[ai, rag, agent, llm, prompt]`；冷启动退化 `all` (无 tag 过滤) | 资深 AI 工程师。熟悉 RAG、agent 架构、prompt engineering、模型选型、推理优化。基于具体实验数据和论文讨论，必要时引用 source |
| **后端架构师** | `notes` + tags `[backend, architecture, system-design, database]`；冷启动退化 `all` (无 tag 过滤) | 资深后端架构师。从可扩展性、数据一致性、运维成本角度切入。会指出隐含的扩展性陷阱 |
| **产品经理** | `all` + tags `[product, ux, growth]`（可选）；冷启动 `all` (无 tag 过滤) | 资深 PM。从用户价值、使用场景、ROI 角度切入。"Don't be diplomatic. Push back when you think a feature isn't worth building." |

**冷启动降级**：如果用户没有对应 tag 或 notebook，scope 退化为 `all`，避免新用户开 channel 后所有 agent 都"我没相关知识"。

---

## 3. 架构总览

### 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React)                                            │
│  /council/[channelId]                                       │
│    - 群聊 UI（多 agent 气泡 + 输入框 + Stop）                │
│    - SSE 客户端：单连接接收整轮                              │
│    - AbortController：用户插话时 abort 当前流                │
└────────────────────┬────────────────────────────────────────┘
                     │ POST /api/council/[channelId]/chat (SSE)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js Route Handler                                      │
│  Council Orchestrator (无状态，per-request 实例)             │
│    1. 落库 user message                                     │
│    2. classify pass: 并发问 N 个 persona "should-speak?"     │
│    3. for highest-priority yes:                             │
│       - 检查 stop condition                                  │
│       - 拉 persona scope RAG                                │
│       - streamText() → 流回前端                              │
│       - 落库 (complete | interrupted)                       │
│       - 回到 step 2 重新 classify                           │
│    4. abort signal → 当前 stream interrupted + 落库          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Existing Knosi infra                                       │
│  - Drizzle / libsql (Turso)                                 │
│  - Provider 抽象 (claude / openai / claude-code daemon)      │
│  - Hybrid RAG (chunks + minisearch + reranker)              │
└─────────────────────────────────────────────────────────────┘
```

### 关键架构决策

**a. 单 HTTP 请求承载整轮讨论**
- 用户发一条 → 服务端跑 classifier → 多个 agent 顺序发言 → 直到本轮终止
- 整个过程是一条 SSE 流，前端不用每次切 agent 都重新发请求
- 服务端用 `for await` 串起多个 `streamText()`，每个 agent 是一段子流，用 envelope 事件告诉前端"agent 切了"

**b. orchestrator 无状态**
- 每个 HTTP 请求重新读 channel 历史 + persona 配置 → 决策 → 流回
- 状态机的"内存"在数据库里（消息表 + 本轮 turn 计数器）而不是进程里
- 与现有 Hetzner k3s 部署天然兼容（pod 重启不丢状态）

**c. 用户插话 = abort 当前请求 + 起新请求**
- 前端 `AbortController.abort()` → 服务端 `req.signal` 感知
- 当前 agent 的部分输出落库标记为 `interrupted`
- 用户新消息发起新 SSE 请求，重新跑 classifier

**d. cheap classifier 并发**
- 一轮里 N 个 persona 的 should-speak 判断并发（`Promise.all`）+ `pLimit(3)` 限流
- 用便宜模型（claude-haiku / gpt-4o-mini）
- 返回 `{ shouldSpeak, priority, reason }`

---

## 4. 数据模型

### Schema (Drizzle, libsql)

```ts
// src/server/db/schema/council.ts

export const personas = sqliteTable("council_personas", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  avatarEmoji: text("avatar_emoji"),
  systemPrompt: text("system_prompt").notNull(),
  styleHint: text("style_hint"),

  // RAG scope (Q11 d: 模块 + 可选 tag 白名单)
  scopeKind: text("scope_kind").notNull(),  // Phase 1: 'all' | 'notes' | 'bookmarks'; Phase 3 加 'learning-notebook' | 'oss-project'
  scopeRefId: text("scope_ref_id"),         // notebook/project id; Phase 1 始终 null
  scopeTags: text("scope_tags"),            // JSON string[]; empty = no filter

  isPreset: integer("is_preset", { mode: "boolean" }).default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  userIdx: index("council_personas_user_idx").on(t.userId),
}));

export const channels = sqliteTable("council_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  topic: text("topic"),
  hardLimitPerTurn: integer("hard_limit_per_turn").notNull().default(6),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  userIdx: index("council_channels_user_idx").on(t.userId),
}));

export const channelPersonas = sqliteTable("council_channel_personas", {
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  personaId: text("persona_id").notNull().references(() => personas.id, { onDelete: "restrict" }),
  joinedAt: integer("joined_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.personaId] }),
}));

export const channelMessages = sqliteTable("council_channel_messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                      // 'user' | 'agent' | 'system'
  personaId: text("persona_id").references(() => personas.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  status: text("status").notNull().default("complete"),  // 'complete' | 'interrupted' | 'error'
  turnId: text("turn_id"),                           // group user msg + triggered agent msgs
  metadata: text("metadata"),                        // JSON: ragSources, priority, stopReason ...
  createdAt: integer("created_at").notNull(),
}, (t) => ({
  channelIdx: index("council_messages_channel_idx").on(t.channelId, t.createdAt),
  turnIdx: index("council_messages_turn_idx").on(t.turnId),
}));
```

### 不引入

- ❌ `channel_members` 未读计数（单用户产品）
- ❌ `messages.parent_id` thread（UI 复杂度爆炸）
- ❌ 单独 `turns` 表（用 `turnId` 关联够用）
- ❌ persona 版本化（直接覆盖）
- ❌ checkpoint 表（d3 才考虑）

---

## 5. Turn-taking 状态机

### 状态机

```
IDLE ──user msg──▶ CLASSIFYING ──queue produced──▶ CHECK_STOP
                                                       │
                  ┌────────────── queue 非空 + 未触发 ──┤
                  ▼                                    │
              STREAMING                                │ queue 空
                  │                                    │ 或 stop 触发
                  ├──本条说完──▶ CLASSIFYING            ▼
                  │                                  STOPPED
                  └──abort────────────────────────────▶
```

### 核心循环（伪代码）

```ts
async function* runTurn({
  channel, personas, userMessage, abortSignal
}): AsyncGenerator<SSEEvent> {
  const turnId = crypto.randomUUID();
  await db.insert(channelMessages).values({ ...userMessage, turnId });
  yield { type: "turn_start", turnId };

  let agentSpoken = 0;
  let lastAgentMessage = null;

  while (true) {
    if (abortSignal.aborted) {
      yield { type: "stopped", reason: "user_interrupt" };
      return;
    }
    if (agentSpoken >= channel.hardLimitPerTurn) {
      yield { type: "stopped", reason: "hard_limit" };
      return;
    }

    const history = await loadRecentHistory(channel.id, { limit: 20 });
    const decisions = await Promise.all(
      personas.map(p => classifyShouldSpeak({ persona: p, history, lastAgentMessage, abortSignal }))
    );
    const queue = decisions
      .filter(d => d.shouldSpeak)
      .sort((a, b) => b.priority - a.priority);

    if (queue.length === 0) {
      // 全员 no = 讨论自然结束。reclassify 之间上下文没变化的情况下重试也是浪费，所以直接停
      // (这里 reason 用 consecutive_no 而不是 no_speakers，因为这两种语义其实合并了——见下方 schema 调整说明)
      yield { type: "stopped", reason: "consecutive_no" };
      return;
    }

    const speaker = queue[0];  // 一次只让队首发言，说完再 reclassify
    const messageId = crypto.randomUUID();
    yield { type: "agent_start", messageId, personaId: speaker.persona.id, turnId };

    let buffer = "";
    let interrupted = false;
    try {
      const stream = streamPersonaResponse({ persona: speaker.persona, history, lastAgentMessage, abortSignal });
      for await (const chunk of stream) {
        if (abortSignal.aborted) { interrupted = true; break; }
        buffer += chunk;
        yield { type: "agent_delta", messageId, delta: chunk };
      }
    } catch (e) {
      if (isAbortError(e)) interrupted = true;
      else throw e;
    }

    await db.insert(channelMessages).values({
      id: messageId, channelId: channel.id, role: "agent",
      personaId: speaker.persona.id, content: buffer,
      status: interrupted ? "interrupted" : "complete",
      turnId, createdAt: Date.now(),
      metadata: JSON.stringify({ priority: speaker.priority }),
    });
    yield { type: "agent_end", messageId, status: interrupted ? "interrupted" : "complete" };

    if (interrupted) {
      yield { type: "stopped", reason: "user_interrupt" };
      return;
    }

    agentSpoken += 1;
    lastAgentMessage = { personaId: speaker.persona.id, content: buffer };
  }
}
```

### Classifier prompt（核心）

```
You are deciding whether the persona "{name}" should speak next in a group discussion.

Persona system prompt (excerpt): {first 200 chars of systemPrompt}
Style hint: {styleHint}

Recent conversation:
{last 8 messages, each as "[name]: content"}

Rules:
1. Speak if you have something genuinely useful, contrarian, or clarifying to say.
2. Don't speak just to agree. Don't repeat what others already said.
3. If the last speaker was you and no new info appeared, do NOT speak again.
4. If the topic clearly isn't your domain, do NOT speak.

Return JSON:
{ "shouldSpeak": boolean, "priority": 0.0-1.0, "reason": "<one short sentence>" }
- priority 0.9+: 强烈想说 (被点名/明显错误要纠正/独到见解)
- priority 0.5-0.8: 有想法可以分享
- priority < 0.5: 勉强想说 (一般 false 更好)
```

**强制 JSON + zod 校验 + 解析失败 fallback 为 no**：

```ts
const ClassifierSchema = z.object({
  shouldSpeak: z.boolean(),
  priority: z.number().min(0).max(1),
  reason: z.string().max(200),
});
```

### 设计要点

- **一次只让队首发言**：每条 agent 发言后上下文变了，原本想说的人可能改主意，原本不说的人可能被激活——所以 reclassify。代价是 N 次便宜调用，由 cheap classifier 设计兜底
- **Abort 一路透传**：前端 AbortController → fetch signal → req.signal → orchestrator → streamText({ abortSignal })。每层用同一个 signal，不要 wrap
- **stopped reason** 区分：`user_interrupt` / `hard_limit` / `consecutive_no` / `user_stop` / `error`

---

## 6. 可中断流：端到端实现

### SSE 事件协议

```ts
type SSEEvent =
  | { type: "turn_start";   turnId: string }
  | { type: "agent_start";  turnId: string; messageId: string; personaId: string }
  | { type: "agent_delta";  messageId: string; delta: string }
  | { type: "agent_end";    messageId: string; status: "complete" | "interrupted" }
  | { type: "stopped";      reason: "hard_limit" | "consecutive_no"
                                  | "user_interrupt" | "user_stop" | "error" }
  | { type: "error";        message: string };
```

### 前端：单连接 + delta 路由

关键代码骨架（详见 spec 4 节伪代码）：

```ts
async function send(text: string) {
  if (abortRef.current) {
    abortRef.current.abort();
    await flushPromiseRef.current;     // 屏障：等旧 stream 真正结束
  }
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  flushPromiseRef.current = doStream(ctrl, text);
  await flushPromiseRef.current;
}
```

`flush 屏障` ≈ 100ms 量级，用户感知不到。这避免了"用户连续插话两次"的竞态。

### 服务端：finally 清理

```ts
const stream = new ReadableStream({
  async start(controller) {
    try {
      for await (const evt of orchestrator.runTurn({ abortSignal: req.signal, ... })) {
        controller.enqueue(encode(evt));
      }
    } catch (e) {
      if (!isAbortError(e)) controller.enqueue(encode({ type: "error", message: e.message }));
    } finally {
      controller.close();
    }
  }
});
return new Response(stream, {
  headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
});
```

被中断的 agent 的部分内容**只在 `agent_end` 落库一次**（不每个 delta 都写）。`status: 'interrupted'` 的 buffer 是当时累积的内容。

### 用户主动 Stop vs 用户插话

底层都是 abort，区别在 `stopped event reason`：
- `user_interrupt`：紧接着发新消息，新一轮把"被打断的发言"当上下文（agent 知道自己刚被打断）
- `user_stop`：没有新消息，只是冻结当前讨论

### 历史 truncate

- 最近 20 条原文（≈ 8~10k tokens）
- 更早的只保留 user 消息原文，agent 发言裁掉
- d2 再考虑跑后台 summarization 落库

### 不做（YAGNI）

- ❌ 断线重连续传：MVP 不做
- ❌ Server-side queue / Redis pubsub
- ❌ Abort 用 mutex 锁（屏障 promise 够）

---

## 7. Persona Scope & RAG

### 核心入口

```ts
export async function searchKnowledgeForPersona({
  persona, query, userId, topK = 6,
}: SearchArgs): Promise<RagHit[]> {
  const sourceFilter = buildSourceFilter(persona);
  return hybridSearch({
    userId, query, topK,
    filter: {
      ...sourceFilter,
      tagsAny: persona.scopeTags ?? [],
    },
  });
}

function buildSourceFilter(p: Persona) {
  // Phase 1 复用 AskAiSourceScope 现有的 'all' | 'notes' | 'bookmarks' 三个值
  switch (p.scopeKind) {
    case "all":       return { scope: "all" as const };
    case "notes":     return { scope: "notes" as const };
    case "bookmarks": return { scope: "bookmarks" as const };
  }
}
// Phase 3 扩展：当 RAG 索引器开始索引 learning-notes / project-notes 时，
// 加 'learning-notebook' / 'oss-project' 两个 scopeKind，并在此 switch 加分支
```

### 设计要点

- **共享 RAG 索引 + 查询过滤**（不是每个 persona 一份独立索引），核心 RAG 管线（MiniSearch + 向量 + reranker）不动
- **Tag 语义 = Any**（命中其一即可）—— 防止 All 太严格导致"什么都查不到"
- **Classifier 不跑 RAG**（成本爆炸）—— 只看 persona 摘要 + 最近对话
- **杠精类 persona 用 systemPrompt 控行为**（"Don't cite sources, ask sharp questions"），不靠 scope
- **冷启动降级到 `scope = all`**：避免新用户 RAG 全空

### Persona prompt 拼装

```
[Persona system prompt]
[Style hint]

[Channel topic + recent conversation (~20 msgs)]

[Knowledge from your scope]
  Source: note "<title>" (id: ...)
  > <chunk content>
  Source: learning-note "<lesson title>"
  > ...

Speak as {personaName}. Be concise. Cite sources by [note: title] when relevant.
You can disagree with what others said. Don't repeat what was said.
```

### 开放问题（性能债）

- **chunks 表是否有冗余 tags 列**？如果没有，tag 过滤要 join 回 source 表。第一版可接受（数据量小），但实现 plan 阶段需要确认；如果性能差，d2 考虑冗余 tags 到 chunks 索引（或单独 chunk_tags 关联表）

---

## 8. UI / 交互

### 信息架构

```
Sidebar 新增 "Council"
  /council                            → 频道列表（Phase 2）
  /council/[channelId]                → 单频道聊天（Phase 1 主战场）
  /council/personas                   → Persona 管理（Phase 2）
```

Phase 1：用户首次进 `/council` → 自动创建默认频道 "#我的圆桌" + 加入 3 个预置 persona → 直接跳转。**第一版只暴露一个频道**。

### 主聊天页布局

```
┌──────────────────────────────────────────────────────────────┐
│ ← Back   #我的圆桌                              ⋯ Settings    │
│ Topic: 抛个问题，三个 AI 一起讨论                              │
├──────────────────────────────────────────────────────────────┤
│ Members: [🤖 AI 工程师]  [🏗️ 后端架构师]  [📊 PM]             │
├──────────────────────────────────────────────────────────────┤
│   [我]  我这个 RAG 该不该加 reranker？                  10:00 │
│                                                              │
│  [🤖 AI 工程师]  从 reranker 实验看，能 +6% recall...   10:01 │
│  [📚 reranker 实验笔记]                                       │
│                                                              │
│  [🏗️ 后端架构师]  正在输入…⠋                                  │
│  模型上线后内存占用是个问题...                                 │
│                                                              │
│  ─── ⏸ 你打断了讨论 ───                                       │
│                                                              │
│   [我]  那如果用 hosted rerank 服务呢？                10:02  │
│                                                              │
│  [🤖 AI 工程师]  Hosted 的话延迟主要看…  ▌                    │
├──────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐  ⏹ Stop      │
│ │ 抛个问题…                                   │  ⏎ Send      │
│ └─────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

### 关键交互

- **气泡视觉**：用户右对齐主色，agent 左对齐 + persona avatar + 颜色编码（每个 persona 一个稳定主色，避免红绿配）；system 居中分隔条
- **正在输入态**：`agent_start` 立刻插占位气泡（"⠋ 正在输入"），`delta` 转打字机，`agent_end` 关光标
- **输入框始终可用**（核心交互！与 Ask AI 反向）：streaming 中 send = abort 当前 + 新一轮；流式中显示独立 ⏹ Stop 按钮
- **被打断视觉**：保留内容 + 文末灰色斜体 "(被你打断了)" + 气泡左侧色条灰化
- **RAG 引用 chip**：`[note: 标题]` 自动渲染为可点 chip，点击侧边 drawer 预览（沿用 Ask AI source citation 组件）
- **stopped 事件视觉反馈**（不同 reason 不同文案）：
  - `hard_limit` → "⏱ 讨论达到本轮上限"
  - `consecutive_no` → "💤 暂时没人想接话了"
  - `user_interrupt` → "⏸ 你打断了讨论"
  - `user_stop` → "⏹ 讨论已停止"
  - `error` → "⚠ 出错了"

### 复用清单

- chat 气泡骨架 ← `src/app/(app)/ask/`
- SSE 解帧 ← Ask AI 已有实现抽公共
- Source citation chip ← 直接复用
- Toast ← `src/components/ui/toast`

### 不做（YAGNI）

- ❌ Markdown 流式渲染（stream 中纯文本，结束后 render md）
- ❌ @mention 自动补全（turn-taking 用 B 不是 A）
- ❌ 消息编辑 / 重发
- ❌ 表情回复

---

## 9. 错误处理

### 错误分类

| 错误类型 | 处理 | 用户感知 |
|---|---|---|
| AbortError | catch 后按 `interrupted` 落库 | "⏸ 你打断了讨论" |
| Provider rate limit / quota | classifier 失败=视为 no；stream 失败=写 system error，跳过该 agent | 该条 ⚠️，其他正常 |
| Provider 5xx / 网络 | stream 重试 1 次；classifier 不重试 | 同上 |
| JSON parse 失败 | zod fallback 为 no（默认不说话） | 无 |
| RAG 查询失败 | persona 退化为"无知识"模式继续生成 | 无 |
| DB 写失败 | user 消息失败 → 整轮 abort + toast；agent 消息失败 → 写 system 错误标记 | toast / ⚠️ |
| 超时（无 chunk > 60s） | abort + 标记 `error` 跳过 | "⚠️ agent 超时" |
| 资源失踪 | persona 缺失从队列剔除；scope 失效降级 `all` + warn | 静默兜底 |

**贯穿原则**：错误隔离到单个 agent，不影响整个 turn。

### 防御性细节

- **Classifier 强约束**：zod schema + safeParse fallback
- **Classifier 并发限流**：`pLimit(3)` 即使 N=3 也加（未来扩 5+ 不被坑）
- **整轮 wall-clock 兜底**：90s `abortSignal` race
- **打断内容写库时机**：`agent_end` 唯一写点，finally 统一处理
- **前端断线**：SSE 断 → req.signal aborted → 自然走 abort 链
- **Idempotency**：messageId 前端生成，主键去重

### 可观测性

沿用 langfuse / 现有 trace：每个 turn 一个 trace，每次 classifier / agent stream 一个 span。指标：
- 每 turn 平均 agent 数（理想 1.5~3）
- classifier yes 比例（>80% 太宽，<20% 太严）
- 中断率（被打断 / 总 turn）
- `interrupted` 状态消息占比

第一版只打日志，不做 dashboard。

---

## 10. 测试策略

### 单元测试 (`src/server/council/__tests__/`)

1. **`orchestrator.spec.ts`** — turn-taking 状态机
   - mock classifier + mock streamPersonaResponse
   - case：全 no → consecutive_no
   - case：每条都 yes → hard_limit
   - case：abort 在第 2 个 agent → 第 1 complete + 第 2 interrupted
   - case：classifier 抛错 → 视为 no
   - case：stream 抛错 → 跳过该 agent 继续
2. **`persona-rag.spec.ts`** — scope 过滤
   - 各 scopeKind 生成的 SQL filter 正确
   - tagsAny=[] 不加过滤；非空加 IN 子句
   - scopeRefId 失效时降级
3. **`classifier-prompt.spec.ts`** — prompt 拼装快照（防回归）

### E2E (`e2e/council.spec.ts`)

1. **golden path**：进 /council → 自动创建 channel → 发问题 → ≥1 agent 流式发言 → stopped 分隔条
2. **打断**：发问题 → agent 流中再发 → 旧气泡 "(被你打断了)" → 新一轮开始
3. **Stop 按钮**：发问题 → 流中点 Stop → "⏹ 讨论已停止" → 输入框可用 → 再发新问题正常
4. **刷新一致**：发问题等讨论完 → 刷新 → 历史完整 + interrupted 状态保留
5. **错误兜底**：mock 一个 persona stream 失败 → 其他正常 → ⚠️ 标记可见

### LLM mock

`COUNCIL_TEST_MODE=true` env：classifier / streamPersonaResponse 命中 fixture，deterministic 响应。**这是 d1 的硬性投入**——不做 e2e 没法稳定。

E2E 数据隔离沿用现有 isolated DB（`docs/changelog/e2e-isolated-test-db.md`）。

---

## 11. 性能 & 成本

### 单 turn 估算（N=3, hard_limit=6）

- 6 次 cheap classifier × 3 persona = 18 次便宜调用（haiku/mini, ~200 tok in / 50 tok out）
- 6 次主模型 stream（每次 ~2k tok in 含 RAG / ~300 tok out）
- **粗估**：~$0.02-0.05 per turn（claude-sonnet 主 + haiku classifier）

数字写明，方便后续优化对比。

### Phase 2 优化点（非 d1 范围）

- Classifier 用本地小模型（Ollama）—— 节省 80%+ classifier 成本
- Persona scope 静态部分缓存（system prompt + RAG fingerprint）
- Anthropic prompt cache（5min TTL）
- Per-persona 历史摘要

---

## 12. MVP 分期

### Phase 1 (d1) — 跑通

- 数据库：4 张新表 + drizzle 迁移 + 种子 3 个预置 persona
- 后端：
  - `POST /api/council/[channelId]/chat` SSE
  - orchestrator + classifier + persona stream + RAG scope
  - 错误隔离 + 兜底超时
- 前端：
  - `/council` 入口 + auto-create 默认 channel
  - 主聊天页（多 agent 气泡 + 输入框始终可用 + Stop 按钮）
  - SSE 单连接 delta 路由 + abort 屏障
- 测试：单元 + e2e + LLM mock 模式
- **不做**：channel CRUD UI、persona CRUD UI、tag 过滤 UI（schema 留好但不暴露）、沉淀为笔记

### Phase 2 (d2) — 产品化

- channel 列表 / 新建 / 删除 UI
- persona 管理页（CRUD + scope 配置 UI）
- "沉淀为笔记"功能
- Markdown 流式渲染优化
- 性能优化（local classifier / prompt cache）

### Phase 3+（不在本 spec 范围）

- **RAG 索引器扩展支持 learning-notes / project-notes**（扩展 `knowledgeChunks.sourceType` enum + indexer + vector-store + agentic-rag），随后 `scopeKind` 加 `learning-notebook` / `oss-project`
- Async daemon 模式（让讨论在后台跑完）
- Checkpoint / 断线恢复
- 多频道 cross-reference（一个频道引用另一个的讨论）

---

## 13. 风险与开放问题

### 风险

1. **Classifier 调参痛苦**：prompt 里"反抢话"规则不好就会有冷场或抢话。需要预留迭代时间，可能需要 5~10 轮 prompt 调试
2. **3 agent 在同一上下文里 voice 区分度**：3 个 persona 的 systemPrompt 如果区分度不够，会让讨论像 ChatGPT 自己分饰多角，无聊。需要在 d1 验证 persona prompt 的 voice 是否真的不一样
3. **Token 成本**：单 turn $0.02-0.05 在自用 OK，但如果之后开放给 hosted 用户需要严格 budget 控制
4. **永久 channel 历史增长**：truncate 策略简单粗暴，长期使用后早期对话会丢失。Phase 2 的 summarization 是必经之路
5. **冷启动 persona scope 退化**：新用户没匹配 tag 时全走 `all`，导致 3 个 agent 看的知识完全一样，差异度受损。需要用户配置成本和体验之间权衡

### 开放问题

1. **chunks 表 tag 关联怎么实现**？需要在 plan 阶段读现有 schema 确认。如果性能差需要冗余字段或独立关联表
2. **provider 抽象的 "cheap" 别名**：现有 provider 抽象有没有标准的"便宜模型"映射？没有的话需要在 d1 加
3. **Persona 颜色 palette**：spec 留 4-color 建议，具体值在实现时定（避免红绿等）
4. **模块名最终用 `Council` 还是中文**：sidebar i18n 怎么处理（其他模块叫 Notes / Learn / Projects / Focus 等英文，对齐）

---

## 14. 验收标准（Definition of Done）

Phase 1 完成判定：

- [ ] 进 `/council` 自动创建默认频道，3 预置 persona 在 member bar 可见
- [ ] 抛一个问题能看到至少 1 个 agent 流式发言
- [ ] 流式过程中再发新消息能正确打断（旧气泡显示打断态 + 新一轮开始）
- [ ] Stop 按钮能正确停止当前讨论
- [ ] 硬上限 6 条到达时显示 "讨论达到本轮上限"
- [ ] 全员 no 时显示 "暂时没人想接话了"
- [ ] 一个 agent 出错时另外两个正常工作 + 错误标记可见
- [ ] 刷新页面后历史完整保留，interrupted 状态正确
- [ ] 单元测试 + e2e 全绿（含 LLM mock 模式）
- [ ] `pnpm build` / `pnpm lint` / `pnpm test:e2e` 全过
- [ ] Phase 1 changelog 写完

---

## 15. 与现有 Knosi 的整合点

| 现有能力 | 整合方式 |
|---|---|
| Provider 抽象 | classifier 走 cheap channel；persona stream 走主 channel |
| Hybrid RAG | `searchKnowledgeForPersona` 在现有 hybridSearch 上加 source/tag 过滤 |
| Source citation chip | 直接复用 |
| Sidebar | 新增 "Council" 顶级入口 |
| E2E isolated DB | 沿用 |
| langfuse trace | turn = trace, classifier/stream = span |
| Auth / userId | 走现有多租户 |

不破坏现有任何模块，纯增量。
