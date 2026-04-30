# Design — Ask AI Tool-Calling Agent (Phase 1)

Date: 2026-04-30
Status: Pending written-spec review

## 1. 问题与动机

knosi 当前的 Ask AI 是「单轮 RAG」：

```
user query → retrieveAgenticContext (一次) → preamble 注入 system prompt
          → LLM 生成最终答案
```

LLM 拿到的素材就是预检索那一次的 top-K，没有机会**在推理过程中决定再搜一次**、读全文、或者抓外部 URL。这导致两类典型场景做不好：

1. **跨笔记对比 / 多角度综合**："对比我笔记里关于 RAG 的不同观点"——
   一次检索能召回相关片段，但 LLM 看到 snippet 后想读完整笔记没有手段
2. **混合内外部资料**："抓这篇文章 + 结合我的笔记给我个摘要"——
   LLM 完全没有抓 URL 的能力

同时，用户感受不到 agent 在"思考"——回答出来之前是黑盒的等待。

## 2. 目标与非目标

### 目标

- Ask AI 升级为**多步 tool-calling agent**，3 个工具：`searchKnowledge` / `readNote` / `fetchUrl`
- LLM 可以在初始 RAG 不够时主动二次检索、读笔记全文、抓 URL
- 前端能**透明显示** tool 调用过程（步骤气泡），`fetchUrl` 用红色徽章高亮
- 解锁多步研究类复合 query（例："对比 X 和 Y" + "抓这篇文章"）
- 通过 Langfuse trace 客观度量 tool 使用 / 平均步数 / 首 token 延迟，一周内能判断是否调参
- **provider 兼容降级**：codex / claude-code-daemon 用户不报错，继续单轮 RAG，但前端 UI 协议统一

### 非目标

- **写入工具**（`createNote` / `updateNote`）—— Phase 2
- **额外读工具**（`listRecent` / `searchByTag` / `getFocusSummary`）—— 非必需，YAGNI
- **per-user OpenAI API key 存储 / settings UI** —— Phase 2 单独做（详见 §5.4）
  MVP 沿用全局 `OPENAI_API_KEY`（admin/self-host key）
- **codex / claude-code-daemon provider 的 tool-calling 适配** —— Phase 2
- **多个 agent / orchestrator 架构（路线 B）** —— 留待路线 A 落地后再评估
- **MCP 服务端把 tools 对外暴露（路线 C）** —— Phase 2，可复用 tool 定义
- **快速回滚 kill switch** —— 用户决策，出问题靠 git revert（详见 §5.5 风险）

## 3. 方案概述

### 架构

```
┌─ Frontend ──────────────────────────────────────────────────┐
│  ask-page-client.tsx  ┐                                     │
│  floating-ask-ai-dock ┼─→ <ChatMessageParts>  (新组件)       │
│  inline-ask-ai-popover┘    │                                │
│                            ├─ TextPart  → markdown          │
│                            ├─ ToolPart  → step badge        │
│                            └─ fetchUrl  → red badge + URL   │
│                                                             │
│  transport = DefaultChatTransport (UI message stream)       │
│  <ApiKeyPrompt> (新, stub) ← Phase 2 BYO key 时激活           │
└──────────────────────┬──────────────────────────────────────┘
                       │ POST /api/chat (UI msg stream)
                       ▼
┌─ /api/chat/route.ts ────────────────────────────────────────┐
│  1. auth + rate-limit (现状)                                 │
│  2. buildChatContext → preamble (RAG 注入，保留)              │
│  3. mode = getProviderMode()                                │
│     ├─ local|openai → buildAskAiTools(ctx)                  │
│     │                  + streamChatResponse(..., {tools})   │
│     └─ codex|daemon → 老路径，无 tools                        │
│                       ↓                                     │
│                       legacy-stream-adapter                 │
│                       (text/plain → UI message envelope)    │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─ src/server/ai/ ────────────────────────────────────────────┐
│  provider/                                                  │
│    types.ts        (+tools? +maxSteps? 字段)                 │
│    ai-sdk.ts       (streamText 接 tools + stopWhen)          │
│    index.ts        (tools 仅在 ai-sdk 分支生效)               │
│  tools/            ← 新目录                                   │
│    index.ts        (buildAskAiTools)                        │
│    search-knowledge.ts                                      │
│    read-note.ts                                             │
│    fetch-url.ts                                             │
│    fetch-url-budget.ts                                      │
│  legacy-stream-adapter.ts (新)                               │
│  agentic-rag.ts    (现状，被 tool 包装)                       │
│  safe-fetch.ts     (现状，被 tool 包装)                       │
└─────────────────────────────────────────────────────────────┘
```

### 数据流（典型多步请求）

以「对比我笔记里关于 RAG 的不同观点 + 抓这篇文章」为例：

```
1. useChat.sendMessage({text}) → POST /api/chat (UI msg stream)
2. route.ts: auth → buildChatContext (preamble 注入) →
              ctx={userId, conversationId, urlBudget} →
              tools=buildAskAiTools(ctx) →
              streamChatResponse({messages, system, tools, maxSteps:6})
3. provider/index.ts: mode==="openai" → streamChatAiSdk
4. provider/ai-sdk.ts: streamText({
     model, messages, system, tools,
     stopWhen: stepCountIs(6),
     experimental_telemetry: { functionId: "ask-ai-agent" }
   }).toUIMessageStreamResponse()
5. LLM 多步循环 (AI SDK 自动驱动):
   step1: text "我需要查找..." + tool_call searchKnowledge
   step2: tool_result → text "看到 2024-08 和 2025-02..." + tool_call readNote
   step3: tool_result → tool_call fetchUrl
   step4: tool_result → text "对比下来..." (最终答案)
   step5: stop (LLM 不再发 tool_call)
6. UI message stream 流回前端，message.parts[] 累积:
   text → tool-searchKnowledge → text → tool-readNote → tool-fetchUrl → text
7. <ChatMessageParts> 遍历 parts 渲染
```

### 关键设计决策

- **混合模式**：保留 preamble 预检索（首 token 延迟不退化）+ 加 tools（复杂问题二次检索）
- **`conversationId` 复用 `chatInputSchema.id`**，作为 fetchUrl 预算的 key
- **URL 预算**：进程内 `Map<conversationId, {count, urlsHit}>`，LRU 上限 500，**不持久化**
  （单实例 Next.js 部署，重启重置可接受）
- **步数上限**：`local` 3 步 / `openai` 6 步（小模型容易循环，大模型给空间）
- **Tool 错误返回 `{error: "..."}` 而非抛出**，让 LLM 看到错误并调整

## 4. 接口设计

### 4.1 `searchKnowledge`

```ts
tool({
  description: "Search the user's personal knowledge base (notes + bookmarks) " +
    "by hybrid retrieval. Use when initial context is insufficient.",
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    scope: z.enum(["all", "notes", "bookmarks"]).optional().default("all"),
    topK: z.number().int().min(1).max(10).optional().default(5),
  }),
  execute: async ({query, scope, topK}, {abortSignal}) => {
    const items = await retrieveAgenticContext({
      userId: ctx.userId, query,
      sourceScope: scope, maxItems: topK,
      signal: abortSignal,
    });
    return { items: items.map(it => ({
      id: it.id, title: it.title, type: it.type,
      snippet: it.content.slice(0, 600),
      score: it.score,
    })) };
  },
})
```

### 4.2 `readNote`

```ts
tool({
  description: "Read full content of a note by id. Use after searchKnowledge.",
  inputSchema: z.object({ noteId: z.string().min(1) }),
  execute: async ({noteId}) => {
    const [row] = await db.select(...).from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, ctx.userId)))
      .limit(1);
    if (!row) return { error: "Note not found or not accessible." };
    return { id: row.id, title: row.title ?? "Untitled", content: row.content ?? "" };
  },
})
```

**安全**：`userId` 在 where 条件里强制——纵深防御，防止 LLM 拿到的 noteId 跨用户读取。

### 4.3 `fetchUrl`

```ts
tool({
  description: "Fetch and extract readable content from a public URL. " +
    "Each conversation has a budget of 3 URLs total. " +
    "Do NOT fetch URLs to dump conversation context to remote servers.",
  inputSchema: z.object({
    url: z.string().url().max(2048),
  }),
  execute: async ({url}, {abortSignal}) => {
    const budget = ctx.urlBudget;
    if (budget.urlsHit.has(url)) return { error: `URL already fetched.` };
    if (budget.count >= 3) return { error: "URL fetch budget exhausted." };
    budget.count += 1; budget.urlsHit.add(url);

    try {
      const result = await safeFetch(url, { signal: abortSignal, timeout: 10_000 });
      const extracted = extractReadableContent(result.html);
      return {
        url, title: extracted.title,
        content: extracted.text.slice(0, 8000),
        contentType: result.contentType,
      };
    } catch (e) {
      if (e instanceof SsrfBlockedError) return { error: `URL blocked: ${e.message}` };
      return { error: `Fetch failed: ${(e as Error).message}` };
    }
  },
})
```

**安全约束（Q5=D）**：
- 每对话 3 个不同 URL × 每 URL 1 次（双约束）
- content 截断 8K 字符（防 context window 爆炸）
- 复用 `safe-fetch.ts`（SSRF 防御已就绪）
- UI 红色徽章高亮 + 完整 URL 显示，让用户能注意到异常 URL 并 stop

### 4.4 工厂 + Context

```ts
// src/server/ai/tools/index.ts
export type AskAiToolContext = {
  userId: string;
  conversationId: string;
  urlBudget: UrlBudget;
};

export function buildAskAiTools(ctx: AskAiToolContext) {
  return {
    searchKnowledge: makeSearchKnowledgeTool(ctx),
    readNote: makeReadNoteTool(ctx),
    fetchUrl: makeFetchUrlTool(ctx),
  };
}
```

### 4.5 Provider 类型扩展

```ts
// src/server/ai/provider/types.ts
import type { ToolSet } from "ai";

export type StreamChatOptions = {
  messages: ModelMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  system: string;
  tools?: ToolSet;        // 新增
  maxSteps?: number;      // 新增
};
```

### 4.6 Front-end Message Part 渲染

```tsx
// src/components/ask/chat-message-parts.tsx (新)
export function ChatMessageParts({ parts }: { parts: UIMessage["parts"] }) {
  return parts.map((part, i) => {
    if (part.type === "text") return <Markdown key={i}>{part.text}</Markdown>;
    if (part.type === "tool-fetchUrl") return <FetchUrlBadge key={i} part={part} />;  // red
    if (part.type.startsWith("tool-")) return <ToolStepBadge key={i} part={part} />;  // gray
    return null;
  });
}
```

三个调用方（`ask-page-client` / `floating-ask-ai-dock` / `inline-ask-ai-popover`）：
1. transport 切到 `DefaultChatTransport`
2. 渲染 message 时改为 `<ChatMessageParts parts={message.parts} />`

## 5. 实现细节

### 5.1 步数上限（Q4=B）

```ts
function maxStepsByMode(mode: AIProviderMode): number {
  if (mode === "openai") return 6;
  if (mode === "local") return 3;
  return 1;  // codex/daemon 走降级，无 tool loop
}
```

### 5.2 URL 预算实现

```ts
// src/server/ai/tools/fetch-url-budget.ts
type UrlBudget = { count: number; urlsHit: Set<string> };
const budgets = new Map<string, UrlBudget>();
const MAX_BUDGETS = 500;

export function getOrCreateUrlBudget(conversationId: string): UrlBudget {
  let b = budgets.get(conversationId);
  if (!b) {
    if (budgets.size >= MAX_BUDGETS) {
      const oldest = budgets.keys().next().value;
      if (oldest) budgets.delete(oldest);
    }
    b = { count: 0, urlsHit: new Set() };
    budgets.set(conversationId, b);
  }
  return b;
}
```

### 5.3 Provider 降级（Q2=A + Q7c）

route.ts 判断 mode + 降级路径：

```ts
const mode = getProviderMode();
const supportsTools = mode === "local" || mode === "openai";

if (supportsTools) {
  const ctx = {
    userId,
    conversationId: parsed.data.id ?? crypto.randomUUID(),
    urlBudget: getOrCreateUrlBudget(parsed.data.id ?? "anon"),
  };
  const tools = buildAskAiTools(ctx);
  return streamChatResponse(
    { messages, system, tools, maxSteps: maxStepsByMode(mode) },
    { userId },
  );
}

// 降级（codex / claude-code-daemon）：
// 1. 不传 tools → 走老路径单轮 RAG
// 2. response 经 legacy-stream-adapter 转 UI message envelope
//    保证前端 transport 协议统一
const legacyResponse = await streamChatResponse(options, { userId });
return adaptTextStreamToUiMessageStream(legacyResponse);
```

`legacy-stream-adapter.ts`（约 30 行）把 `text/plain` SSE 包成 UI message stream 的
text-part envelope。

### 5.4 OpenAI Key 处理（方案 Y）

**MVP 阶段**：保持现状——`provider/ai-sdk.ts:38` 直接读 `process.env.OPENAI_API_KEY`。
- 自托管 admin 在 `.env.local` 配 key → 所有用户共享
- hosted 部署同理（admin 出 key 给所有 ask）
- 没配 key + mode=openai → throw `Missing OPENAI_API_KEY`（现状行为）

**与 Q7c 的关系**：UI 层面的 `<ApiKeyPrompt>` 引导横幅**先做成 stub**——
渲染逻辑就位，但触发条件先注释掉。Phase 2 上线 BYO key 时再激活。
理由：
- knosi 主场景是自托管 + 朋友圈使用，admin key 模式合理
- BYO key 涉及 schema 变更（`users.openai_api_key`）+ 加密存储 + settings UI，
  独立做一个 Phase 更干净
- 可以先不挡 MVP 时间线

### 5.5 Feature Flag（Q7b=A，无 kill switch）

**默认全开**，无 env 开关。理由：
- 没配 OpenAI key 的用户：`provider/ai-sdk.ts` 现有 throw 行为已是天然降级
- codex / daemon 用户：走 §5.3 的降级路径，不受影响
- 真出问题靠 `git revert` + push（部署窗口 3-5 分钟）

**已识别但接受的风险**：
- 出现问题没有 30 秒级回滚开关——产品决策已确认
- token 成本上限：openai 模式最坏 6 步循环，接受 ~6× 单轮 token 成本

### 5.6 Langfuse 观测（Q8=B）

```ts
streamText({
  ...,
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: shouldRecordTelemetryContent(),
    recordOutputs: shouldRecordTelemetryContent(),
    functionId: "ask-ai-agent",  // 新 id，区分老的 "chat"
    metadata: {
      mode,
      maxSteps,
      hasTools: true,
    },
  },
});
```

一周后在 Langfuse 看：
- 平均步数（按 mode 分桶）
- tool 调用频率（按 tool name）
- 首 token 延迟 vs 老的 `functionId="chat"`
- 成本 / 请求

### 5.7 待 Step 1 (实现期) 验证的依赖

实现前必须 `pnpm install` 并确认以下事实：

1. **AI SDK v6 (`ai@^6.0.134`) 的 tool API 签名**：
   `tool({...})`、`stopWhen: stepCountIs(N)`、`toUIMessageStreamResponse()`
   实际名称和参数。读 `node_modules/ai/dist/index.d.ts`（CLAUDE.md 要求）
2. **`retrieveAgenticContext` 是否接受 `signal` 参数**——
   不接受则需要小重构（10 行）
3. **`fetch-content.ts` 的 `extractReadableContent` 是否可独立 import**——
   不可则需要从 bookmark 抓取流程拆出
4. **`@ai-sdk/react` 的 `DefaultChatTransport` 实际名称和 message.parts 类型**

## 6. 错误处理

| 层级 | 来源 | 处理方 | 用户感知 |
|---|---|---|---|
| L1 | tool 内部（DB miss / fetch fail / 预算超限）| tool execute try-catch → `{error}` | LLM 看到 + UI 红/灰徽章 |
| L2 | tool input schema 校验失败 | AI SDK 自动 → `tool-output.errorText` | 同上 |
| L3 | LLM / 流（OpenAI 429 / abort / 模型崩）| `streamText.onError` | UI toast + 已生成内容保留 |
| L4 | route 级（auth / parse）| route.ts try-catch（现状）| 401/400/500 JSON |

**核心原则**：L1/L2 错误**永不抛到 stream 之外**——LLM 看到错误后能主动调整下一步。

## 7. 测试与验收

### 7.1 单元测试（vitest）

- `tools/search-knowledge.test.ts` —— mock `retrieveAgenticContext`，
  验证 input 校验、snippet 截断、错误返回
- `tools/read-note.test.ts` —— 用 in-memory libsql DB，
  验证 userId 隔离（A 用户拿不到 B 的 noteId）
- `tools/fetch-url.test.ts` —— mock `safeFetch`，
  验证预算计数、重复 URL 拦截、错误转译
- `tools/fetch-url-budget.test.ts` —— LRU 淘汰、并发计数

### 7.2 集成测试

用 AI SDK 的 `MockLanguageModelV2` 喂预设 tool_call 序列，
验证多步循环正确累积、`stopWhen` 命中、abort 传播。

### 7.3 E2E（playwright，新增 1 个 spec）

`e2e/ask-ai-tools.spec.ts`：
- 主路径：`AI_PROVIDER=openai` + 测试 OpenAI key 或 mock server →
  发 prompt → 等流结束 →
  assert `message.parts` 至少含 1 个 `tool-searchKnowledge` part + 1 个 `text` part
- 降级路径：`AI_PROVIDER=codex` →
  同 prompt → assert 不含 tool part 但答案非空（验证 §5.3 adapter）

### 7.4 手工验收（你自己用一周）

5 个真实 query 跑一遍，记录在 `docs/changelog/phase-ask-ai-tool-calling.md`：
- "对比我笔记里关于 RAG 的不同观点"
- "抓 https://... + 结合我的笔记给摘要"
- "我笔记里有没有关于 X 的内容"（简单 query，验证 1 步搞定不浪费）
- 故意拼错的 query（验证错误恢复）
- 触碰预算上限的 query（"抓这 5 个 URL"，验证降级到 3 个）

重点关注：local 模式（qwen2.5）会不会循环、fetchUrl 红色徽章是否突出、
首 token 延迟是否退化。

## 8. 影响范围

- **`src/server/ai/provider/types.ts`**：`StreamChatOptions` 加 `tools?` `maxSteps?`
- **`src/server/ai/provider/ai-sdk.ts`**：`streamText` 透传 tools + `stopWhen`，
  response 切 `toUIMessageStreamResponse()`
- **`src/server/ai/provider/index.ts`**：tool 仅在 ai-sdk 分支透传，其他 provider 忽略
- **`src/server/ai/chat-system-prompt.ts`**：system prompt 加 tool 使用引导段
- **`src/app/api/chat/route.ts`**：mode 分流 + 降级 adapter
- **`src/server/ai/tools/`**：新目录（4 文件）
- **`src/server/ai/legacy-stream-adapter.ts`**：新文件
- **`src/components/ask/chat-message-parts.tsx`**：新组件
- **`src/components/ask/ask-page-client.tsx`** + **`floating-ask-ai-dock.tsx`**
  + **`src/components/editor/inline-ask-ai-popover.tsx`**：transport 切换 + 渲染替换
- **`src/components/ask/api-key-prompt.tsx`**：新组件（stub，暂不激活）

**不影响**：
- daemon 链路（`chat-enqueue` / `daemon-mode` / `/api/daemon/*`）—— 走降级保持原样
- billing / entitlements
- DB schema

## 9. 排期估算

| 模块 | 工时 |
|---|---|
| 依赖确认（pnpm install + 读 AI SDK v6 doc）| 0.5d |
| 3 个 tool 实现 + 单测 | 1.5d |
| Provider 类型扩展 + ai-sdk.ts + index.ts 改造 | 0.5d |
| route.ts mode 分流 + legacy-stream-adapter | 1d |
| 前端 ChatMessageParts + 3 处 transport 切换 | 1.5d |
| Langfuse functionId / system prompt 调整 | 0.5d |
| E2E + 手工验收 + changelog | 1d |
| Buffer（v6 API 与预期不符的修正）| 0.5d |
| **总计** | **~7d** |

## 10. 风险 & 已识别的坑

- **AI SDK v6 API 与预期不符**——v6 是较新版本，tool API 可能与 mental model 有差异。
  **缓解**：实现前先 `pnpm install` 读 `node_modules/ai/dist/`；在 spec 里只做 API 形态描述，不锁死字段名
- **本地模型（qwen2.5:14b）tool calling 不稳**——可能死循环或忽略 tools。
  **缓解**：`maxSteps=3` 兜底；手工验收阶段重点观察
- **fetchUrl 预算被 LLM 绕过**：尝试不同子路径同一站点。
  **缓解**：MVP 接受这个简化（按完整 URL 计数）；Phase 2 可改为按 host 计数
- **codex/daemon 降级 adapter 复杂度低估**——
  现有 `streamChatCodex` 返回的是 `Response`（已 `toTextStreamResponse`），
  需要 unwrap 后包成 UI message envelope。**缓解**：spec 里列为已识别工程量
- **token 成本爆炸**：用户 Q7b 选了无 kill switch，
  最坏情况 openai 6 步循环 ≈ 6× 单轮成本。**缓解**：Langfuse 一周观测，
  超阈值则手动加 kill switch（git revert 走起）
- **prompt injection 经 fetchUrl 外发**：限流 + UI 红色徽章 + 用户自停。
  **MVP 接受残留风险**

## 11. 后续 Phase（不在本次范围）

- **Phase 1.5（可选）**：MCP 服务端把同一组 tool 定义对外暴露
  （路线 C），让 Claude Desktop / Cursor 也能用 knosi 当后端
- **Phase 2**：BYO per-user OpenAI key（schema + 加密存储 + settings UI），
  激活 `<ApiKeyPrompt>`
- **Phase 2**：codex / claude-code-daemon 的 tool-calling 适配
- **Phase 3（评估）**：路线 B——orchestrator + specialist 多 agent，
  跑在 daemon-mode 上，需要 `agent_runs` 表
- **Phase 4（评估）**：写入工具（`createNote` / `updateNote`），
  带 dry-run / 用户确认 UI
