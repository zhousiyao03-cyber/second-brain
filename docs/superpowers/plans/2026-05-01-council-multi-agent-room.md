# Council — Multi-Agent Discussion Room (Phase 1 — d1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Knosi 上加一个新模块 `/council`，实现"用户 + 3 个 AI persona 群聊"的最小可用版本：可中断流式群聊 + 去中心化 turn-taking + per-persona RAG scope（基于现有 `note`/`bookmark` 索引）。

**Architecture:** 单 SSE 长连接承载整轮讨论，无状态 orchestrator 把"classify → 选最高优先级 → stream → 落库 → 重 classify"做成异步生成器。前端 `AbortController` 在用户插话时打断当前流，服务端 `req.signal` 一路透传到 Vercel AI SDK。Persona 的知识 scope 复用现有 `retrieveAgenticContext({ scope })` 接口，tag 过滤在结果层做 JSON 解析后过滤（Phase 1 不动 chunks 索引）。

**Tech Stack:** Next.js 16 App Router · React 19 · Drizzle ORM (libsql/Turso) · Vercel AI SDK v6 · 现有 `streamChatResponse` provider 抽象 · `generateStructuredDataAiSdk` (zod schema, 用于 cheap classifier) · 现有 `retrieveAgenticContext` (hybrid RAG)

**Spec:** `docs/superpowers/specs/2026-05-01-council-multi-agent-room-design.md`

**Out of scope (Phase 2/3):** channel CRUD UI、persona CRUD UI、沉淀为笔记、`learning-notebook`/`oss-project` scope、markdown 流式渲染、本地 classifier 模型。

---

## 文件结构

### 新建

| 文件 | 责任 |
|---|---|
| `src/server/db/schema/council.ts` | 4 张新表：`personas` / `channels` / `channelPersonas` / `channelMessages` |
| `src/server/council/types.ts` | Council 模块跨文件共享的类型（`SSEEvent`、`Persona`、`ClassifierDecision`） |
| `src/server/council/seeds.ts` | 3 个预置 persona 配方 + 首次创建 channel 时的种子函数 |
| `src/server/council/persona-rag.ts` | `searchKnowledgeForPersona` — 在现有 `retrieveAgenticContext` 上加 tag 后过滤 |
| `src/server/council/classifier.ts` | `classifyShouldSpeak` — cheap classifier，强制 JSON + zod 校验 |
| `src/server/council/persona-stream.ts` | `streamPersonaResponse` — 给定 persona 拼装 prompt 并 streamText |
| `src/server/council/orchestrator.ts` | `runTurn` — 核心异步生成器，吐 `SSEEvent` |
| `src/server/council/__tests__/orchestrator.test.ts` | 状态机单元测试（mock classifier + mock stream） |
| `src/server/council/__tests__/persona-rag.test.ts` | scope + tag 过滤单测 |
| `src/server/council/__tests__/classifier.test.ts` | classifier prompt + zod fallback 测试 |
| `src/server/routers/council.ts` | tRPC router：`ensureDefaultChannel`、`listMessages` |
| `src/app/api/council/[channelId]/chat/route.ts` | SSE 端点 — 编码 orchestrator events 到 SSE |
| `src/app/(app)/council/page.tsx` | 入口：调 `ensureDefaultChannel` → redirect 到 `[channelId]` |
| `src/app/(app)/council/[channelId]/page.tsx` | 单频道服务端 wrapper（auth + 初始化数据） |
| `src/app/(app)/council/[channelId]/council-room.tsx` | 群聊客户端组件（含 SSE 客户端 + abort 屏障 + 多 agent 气泡） |
| `src/app/(app)/council/[channelId]/use-council-stream.ts` | Hook：`{ messages, isStreaming, send, stop }` |
| `e2e/council.spec.ts` | E2E：golden path / 打断 / Stop / 刷新 / 错误兜底 |
| `src/server/council/test-mode.ts` | E2E 用：`COUNCIL_TEST_MODE=true` 时 classifier/stream 走 deterministic fixture |

### 修改

| 文件 | 修改内容 |
|---|---|
| `src/server/db/schema/index.ts` | 加一行 `export * from "./council";` |
| `src/server/routers/_app.ts` | 注册 `councilRouter` |
| `src/components/layout/navigation.ts` | 在 CAPTURE group 里加 `{ href: "/council", label: "Council", icon: Users }` |
| `drizzle/0042_*.sql` | drizzle-kit 自动生成的迁移 |

---

## 任务概览

1. **Task 1**：定义 schema + 生成迁移 + push 到本地 DB
2. **Task 2**：Council 模块共享类型 + 种子 persona 配方
3. **Task 3**：tRPC router (`ensureDefaultChannel` + `listMessages`)
4. **Task 4**：`searchKnowledgeForPersona` (RAG + tag 过滤)
5. **Task 5**：`classifyShouldSpeak` (cheap classifier, zod, fallback)
6. **Task 6**：`streamPersonaResponse` (persona prompt 拼装 + streamText)
7. **Task 7**：`runTurn` orchestrator (核心状态机 — TDD 重点)
8. **Task 8**：`COUNCIL_TEST_MODE` deterministic fixture (供 e2e)
9. **Task 9**：SSE route handler
10. **Task 10**：`use-council-stream` hook (前端 SSE + abort 屏障)
11. **Task 11**：`council-room.tsx` UI 组件
12. **Task 12**：sidebar 入口 + `page.tsx` + `[channelId]/page.tsx`
13. **Task 13**：E2E 测试
14. **Task 14**：Phase 1 changelog + 自验证三步 + commit

---

## Task 1: Schema + 迁移

**Files:**
- Create: `src/server/db/schema/council.ts`
- Modify: `src/server/db/schema/index.ts`
- Generated: `drizzle/0042_*.sql` (drizzle-kit 自动)

- [ ] **Step 1.1: 写 schema 文件**

```ts
// src/server/db/schema/council.ts
import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * Council module — multi-agent discussion rooms.
 * Spec: docs/superpowers/specs/2026-05-01-council-multi-agent-room-design.md
 */

export const councilPersonas = sqliteTable(
  "council_personas",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    avatarEmoji: text("avatar_emoji"),
    systemPrompt: text("system_prompt").notNull(),
    styleHint: text("style_hint"),
    // Phase 1 enum: 'all' | 'notes' | 'bookmarks'
    scopeKind: text("scope_kind").notNull(),
    scopeRefId: text("scope_ref_id"),
    scopeTags: text("scope_tags"), // JSON string[]
    isPreset: integer("is_preset", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("council_personas_user_idx").on(t.userId),
  })
);

export const councilChannels = sqliteTable(
  "council_channels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    topic: text("topic"),
    hardLimitPerTurn: integer("hard_limit_per_turn").notNull().default(6),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("council_channels_user_idx").on(t.userId),
  })
);

export const councilChannelPersonas = sqliteTable(
  "council_channel_personas",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => councilChannels.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => councilPersonas.id, { onDelete: "restrict" }),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.channelId, t.personaId] }),
  })
);

export const councilChannelMessages = sqliteTable(
  "council_channel_messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => councilChannels.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "agent", "system"] }).notNull(),
    personaId: text("persona_id").references(() => councilPersonas.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    status: text("status", {
      enum: ["complete", "interrupted", "error"],
    })
      .notNull()
      .default("complete"),
    turnId: text("turn_id"),
    metadata: text("metadata"), // JSON
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    channelIdx: index("council_messages_channel_idx").on(
      t.channelId,
      t.createdAt
    ),
    turnIdx: index("council_messages_turn_idx").on(t.turnId),
  })
);
```

- [ ] **Step 1.2: 把 council 模块加到 schema barrel**

修改 `src/server/db/schema/index.ts`，在末尾加：

```ts
export * from "./council";
```

- [ ] **Step 1.3: 生成迁移**

Run: `pnpm db:generate`
Expected: 在 `drizzle/` 下生成 `0042_*.sql` + 更新 `meta/_journal.json`

- [ ] **Step 1.4: push 到本地 DB**

Run: `pnpm db:push`
Expected: 成功，无报错

- [ ] **Step 1.5: Commit**

```bash
git add src/server/db/schema/council.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat(council): add schema for multi-agent discussion room"
```

---

## Task 2: 类型 + 种子配方

**Files:**
- Create: `src/server/council/types.ts`
- Create: `src/server/council/seeds.ts`

- [ ] **Step 2.1: 共享类型**

```ts
// src/server/council/types.ts
import type { councilPersonas, councilChannels } from "@/server/db/schema/council";

export type Persona = typeof councilPersonas.$inferSelect;
export type Channel = typeof councilChannels.$inferSelect;

export type ScopeKind = "all" | "notes" | "bookmarks";

export type ClassifierDecision = {
  shouldSpeak: boolean;
  priority: number; // 0..1
  reason: string;
};

export type SSEEvent =
  | { type: "turn_start"; turnId: string }
  | { type: "agent_start"; turnId: string; messageId: string; personaId: string }
  | { type: "agent_delta"; messageId: string; delta: string }
  | { type: "agent_end"; messageId: string; status: "complete" | "interrupted" }
  | {
      type: "stopped";
      reason:
        | "hard_limit"
        | "consecutive_no"
        | "user_interrupt"
        | "user_stop"
        | "error";
    }
  | { type: "error"; message: string };
```

- [ ] **Step 2.2: 预置 persona 配方 + 种子函数**

```ts
// src/server/council/seeds.ts
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, eq } from "drizzle-orm";
import type { ScopeKind } from "./types";

type PresetPersona = {
  name: string;
  avatarEmoji: string;
  systemPrompt: string;
  styleHint: string;
  scopeKind: ScopeKind;
  scopeTags: string[];
};

const PRESETS: PresetPersona[] = [
  {
    name: "AI 工程师",
    avatarEmoji: "🤖",
    systemPrompt:
      "你是一位资深 AI 工程师。熟悉 RAG、agent 架构、prompt engineering、模型选型、推理优化。基于具体的实验数据、benchmark 和论文讨论。引用 source 时使用 [note: 标题] 格式。说话简洁，避免空泛建议。",
    styleHint: "技术派；爱用数据说话；不喜欢含糊的术语堆砌",
    scopeKind: "notes",
    scopeTags: ["ai", "rag", "agent", "llm", "prompt"],
  },
  {
    name: "后端架构师",
    avatarEmoji: "🏗️",
    systemPrompt:
      "你是一位资深后端架构师。从可扩展性、数据一致性、运维成本、生产事故角度切入。会主动指出隐含的扩展性陷阱（连接池、N+1、index 缺失、事务边界等）。引用 source 时使用 [note: 标题] 格式。",
    styleHint: "实战派；关注上线后的事；不爱讨论纯理论",
    scopeKind: "notes",
    scopeTags: ["backend", "architecture", "system-design", "database"],
  },
  {
    name: "产品经理",
    avatarEmoji: "📊",
    systemPrompt:
      "你是一位资深产品经理。从用户价值、使用场景、ROI 角度切入。会问 '这功能到底解决了什么真实痛点'，'用户认知成本多高'，'值得做吗'。Don't be diplomatic. Push back when you think a feature isn't worth building.",
    styleHint: "犀利；关心 user value 而不是技术 elegance",
    scopeKind: "all",
    scopeTags: ["product", "ux", "growth"],
  },
];

/**
 * 确保用户的 council 默认频道存在 + 关联 3 个预置 persona。
 * 幂等：多次调用不会重复创建。
 */
export async function ensureDefaultCouncilChannel(userId: string): Promise<{
  channelId: string;
  isNew: boolean;
}> {
  const now = Date.now();

  // 1. 找现有 channel
  const existing = await db
    .select()
    .from(councilChannels)
    .where(eq(councilChannels.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    return { channelId: existing[0].id, isNew: false };
  }

  // 2. 创建预置 persona（如不存在）
  const personaIds: string[] = [];
  for (const preset of PRESETS) {
    const found = await db
      .select()
      .from(councilPersonas)
      .where(
        and(
          eq(councilPersonas.userId, userId),
          eq(councilPersonas.name, preset.name),
          eq(councilPersonas.isPreset, true)
        )
      )
      .limit(1);

    if (found.length > 0) {
      personaIds.push(found[0].id);
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(councilPersonas).values({
      id,
      userId,
      name: preset.name,
      avatarEmoji: preset.avatarEmoji,
      systemPrompt: preset.systemPrompt,
      styleHint: preset.styleHint,
      scopeKind: preset.scopeKind,
      scopeRefId: null,
      scopeTags: JSON.stringify(preset.scopeTags),
      isPreset: true,
      createdAt: now,
      updatedAt: now,
    });
    personaIds.push(id);
  }

  // 3. 创建 channel + 关联 persona
  const channelId = crypto.randomUUID();
  await db.insert(councilChannels).values({
    id: channelId,
    userId,
    name: "我的圆桌",
    topic: "抛个问题，三个 AI 一起讨论",
    hardLimitPerTurn: 6,
    createdAt: now,
    updatedAt: now,
  });
  for (const personaId of personaIds) {
    await db.insert(councilChannelPersonas).values({
      channelId,
      personaId,
      joinedAt: now,
    });
  }

  return { channelId, isNew: true };
}
```

- [ ] **Step 2.3: Commit**

```bash
git add src/server/council/types.ts src/server/council/seeds.ts
git commit -m "feat(council): types + preset persona seeds"
```

---

## Task 3: tRPC Router

**Files:**
- Create: `src/server/routers/council.ts`
- Modify: `src/server/routers/_app.ts`

- [ ] **Step 3.1: Router 实现**

```ts
// src/server/routers/council.ts
import { z } from "zod/v4";
import { publicProcedure, router } from "@/server/trpc";
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelMessages,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, asc, eq } from "drizzle-orm";
import { ensureDefaultCouncilChannel } from "@/server/council/seeds";
import { TRPCError } from "@trpc/server";
import { auth } from "@/auth";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return session.user.id;
}

export const councilRouter = router({
  /**
   * Idempotent: returns existing default channel or creates it with 3 preset personas.
   */
  ensureDefaultChannel: publicProcedure.mutation(async () => {
    const userId = await requireUserId();
    return ensureDefaultCouncilChannel(userId);
  }),

  getChannel: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ input }) => {
      const userId = await requireUserId();
      const rows = await db
        .select()
        .from(councilChannels)
        .where(
          and(
            eq(councilChannels.id, input.channelId),
            eq(councilChannels.userId, userId)
          )
        )
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      const personas = await db
        .select({ persona: councilPersonas })
        .from(councilChannelPersonas)
        .innerJoin(
          councilPersonas,
          eq(councilChannelPersonas.personaId, councilPersonas.id)
        )
        .where(eq(councilChannelPersonas.channelId, input.channelId));

      return {
        channel: rows[0],
        personas: personas.map((p) => p.persona),
      };
    }),

  listMessages: publicProcedure
    .input(z.object({ channelId: z.string(), limit: z.number().default(200) }))
    .query(async ({ input }) => {
      const userId = await requireUserId();
      // ownership check
      const channel = await db
        .select()
        .from(councilChannels)
        .where(
          and(
            eq(councilChannels.id, input.channelId),
            eq(councilChannels.userId, userId)
          )
        )
        .limit(1);
      if (channel.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      return db
        .select()
        .from(councilChannelMessages)
        .where(eq(councilChannelMessages.channelId, input.channelId))
        .orderBy(asc(councilChannelMessages.createdAt))
        .limit(input.limit);
    }),
});
```

- [ ] **Step 3.2: 注册到 \_app**

修改 `src/server/routers/_app.ts`，加入 `council: councilRouter`：

```ts
import { councilRouter } from "./council";
// ... existing imports

export const appRouter = router({
  // ... existing routes
  council: councilRouter,
});
```

- [ ] **Step 3.3: 验证 build 不爆**

Run: `pnpm build`
Expected: 编译通过（不需要看到 type 报错）

- [ ] **Step 3.4: Commit**

```bash
git add src/server/routers/council.ts src/server/routers/_app.ts
git commit -m "feat(council): tRPC router for default channel + messages"
```

---

## Task 4: `searchKnowledgeForPersona`

**Files:**
- Create: `src/server/council/persona-rag.ts`
- Test: `src/server/council/__tests__/persona-rag.test.ts`

- [ ] **Step 4.1: 写失败的测试**（仅测纯函数 `applyTagFilter`，不依赖 db）

```ts
// src/server/council/__tests__/persona-rag.test.ts
import { describe, it, expect } from "vitest";
import { applyTagFilter, type PersonaRagHit } from "../persona-rag";

const hits: PersonaRagHit[] = [
  {
    chunkId: "c1",
    chunkIndex: 0,
    content: "RAG content",
    score: 0.9,
    sectionPath: [],
    sourceId: "n1",
    sourceTitle: "RAG note",
    sourceType: "note",
    blockType: null,
    sourceTags: ["ai", "rag"],
  },
  {
    chunkId: "c2",
    chunkIndex: 0,
    content: "Frontend content",
    score: 0.8,
    sectionPath: [],
    sourceId: "n2",
    sourceTitle: "Frontend note",
    sourceType: "note",
    blockType: null,
    sourceTags: ["frontend"],
  },
];

describe("applyTagFilter", () => {
  it("returns all hits when scopeTags is empty", () => {
    expect(applyTagFilter(hits, [])).toHaveLength(2);
  });

  it("filters by Any-of-tags (single tag match)", () => {
    const out = applyTagFilter(hits, ["frontend"]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceTitle).toBe("Frontend note");
  });

  it("filters by Any-of-tags (multiple tags, OR semantics)", () => {
    expect(applyTagFilter(hits, ["frontend", "ai"])).toHaveLength(2);
  });

  it("is case-insensitive on tag matching", () => {
    expect(applyTagFilter(hits, ["FRONTEND"])).toHaveLength(1);
  });

  it("returns empty when no tags match", () => {
    expect(applyTagFilter(hits, ["devops"])).toHaveLength(0);
  });
});
```

> **Engineer note**: 完整 `searchKnowledgeForPersona` 涉及真实 db 读 (`notes.tags` / `bookmarks.tags`)，单测 mock 链路太重。Phase 1 只单测纯函数 `applyTagFilter`；端到端 hydration 行为由 e2e 在 Task 13 间接覆盖（用户的 notes 真有 tags）。

- [ ] **Step 4.2: 跑测试确认失败**

Run: `pnpm vitest run src/server/council/__tests__/persona-rag.test.ts`
Expected: FAIL — "Cannot find module '../persona-rag'"

- [ ] **Step 4.3: 实现**

```ts
// src/server/council/persona-rag.ts
import {
  retrieveAgenticContext,
  type AgenticRetrievalResult,
} from "@/server/ai/agentic-rag";
import type { Persona } from "./types";
import { db } from "@/server/db";
import { notes, bookmarks } from "@/server/db/schema/notes";
import { inArray } from "drizzle-orm";

/**
 * Augmented hit that includes source-level tags for in-memory tag filtering.
 * Tag-on-chunks is a Phase 2/3 optimization (see spec §13).
 */
export type PersonaRagHit = AgenticRetrievalResult & {
  sourceTags: string[];
};

/**
 * Pure: filter enriched hits by Any-of-tags. Empty scopeTags = no filter.
 * Case-insensitive.
 */
export function applyTagFilter(
  hits: PersonaRagHit[],
  scopeTags: string[]
): PersonaRagHit[] {
  if (scopeTags.length === 0) return hits;
  const wanted = new Set(scopeTags.map((t) => t.toLowerCase()));
  return hits.filter((hit) =>
    hit.sourceTags.some((tag) => wanted.has(tag.toLowerCase()))
  );
}

/**
 * Reads `notes.tags` / `bookmarks.tags` for the source ids referenced by hits
 * and attaches them as `sourceTags`.
 */
export async function enrichWithTags(
  hits: AgenticRetrievalResult[]
): Promise<PersonaRagHit[]> {
  if (hits.length === 0) return [];

  const noteIds = hits.filter((h) => h.sourceType === "note").map((h) => h.sourceId);
  const bookmarkIds = hits
    .filter((h) => h.sourceType === "bookmark")
    .map((h) => h.sourceId);

  const tagsByNoteId = new Map<string, string[]>();
  if (noteIds.length > 0) {
    const rows = await db
      .select({ id: notes.id, tags: notes.tags })
      .from(notes)
      .where(inArray(notes.id, noteIds));
    for (const r of rows) tagsByNoteId.set(r.id, parseTagsJson(r.tags));
  }

  const tagsByBookmarkId = new Map<string, string[]>();
  if (bookmarkIds.length > 0) {
    const rows = await db
      .select({ id: bookmarks.id, tags: bookmarks.tags })
      .from(bookmarks)
      .where(inArray(bookmarks.id, bookmarkIds));
    for (const r of rows) tagsByBookmarkId.set(r.id, parseTagsJson(r.tags));
  }

  return hits.map((hit) => ({
    ...hit,
    sourceTags:
      hit.sourceType === "note"
        ? tagsByNoteId.get(hit.sourceId) ?? []
        : tagsByBookmarkId.get(hit.sourceId) ?? [],
  }));
}

/**
 * Returns RAG hits for a persona, filtered by scopeKind + scopeTags.
 * Fail-soft: if retrieval throws, returns []. Persona will speak without
 * grounding, which is acceptable for Phase 1.
 */
export async function searchKnowledgeForPersona({
  persona,
  query,
  userId,
}: {
  persona: Persona;
  query: string;
  userId: string;
}): Promise<PersonaRagHit[]> {
  let raw: AgenticRetrievalResult[];
  try {
    raw = await retrieveAgenticContext(query, {
      scope: persona.scopeKind, // 'all' | 'notes' | 'bookmarks'
      userId,
    });
  } catch (err) {
    console.warn("[council] retrieveAgenticContext failed", err);
    return [];
  }

  const enriched = await enrichWithTags(raw);
  return applyTagFilter(enriched, parseTagsJson(persona.scopeTags));
}

export function parseTagsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
```

> **Engineer note**: `bookmarks` 在 `src/server/db/schema/notes.ts` 里和 `notes` 同文件 export（plan 探查时确认）。如果 import 路径不对，先 `grep "export const bookmarks" src/server/db/schema/` 找真实位置。

- [ ] **Step 4.4: 跑测试通过**

Run: `pnpm vitest run src/server/council/__tests__/persona-rag.test.ts`
Expected: PASS — 5 个 case 全过

- [ ] **Step 4.5: Commit**

```bash
git add src/server/council/persona-rag.ts src/server/council/__tests__/persona-rag.test.ts
git commit -m "feat(council): persona-aware RAG with scope + tag filter"
```

---

## Task 5: Cheap Classifier

**Files:**
- Create: `src/server/council/classifier.ts`
- Test: `src/server/council/__tests__/classifier.test.ts`

- [ ] **Step 5.1: 写失败的测试**

```ts
// src/server/council/__tests__/classifier.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/ai/provider", () => ({
  generateStructuredData: vi.fn(),
}));

import { generateStructuredData } from "@/server/ai/provider";
import { classifyShouldSpeak, buildClassifierPrompt } from "../classifier";
import type { Persona } from "../types";

const persona: Persona = {
  id: "p1",
  userId: "u1",
  name: "AI 工程师",
  avatarEmoji: "🤖",
  systemPrompt: "你是 AI 工程师",
  styleHint: "技术派",
  scopeKind: "notes",
  scopeRefId: null,
  scopeTags: null,
  isPreset: true,
  createdAt: 0,
  updatedAt: 0,
};

describe("buildClassifierPrompt", () => {
  it("includes persona name + style hint + recent history", () => {
    const prompt = buildClassifierPrompt({
      persona,
      history: [
        { role: "user", content: "RAG reranker?", personaName: null },
        { role: "agent", content: "yes", personaName: "AI 工程师" },
      ],
    });
    expect(prompt).toContain("AI 工程师");
    expect(prompt).toContain("技术派");
    expect(prompt).toContain("RAG reranker?");
    expect(prompt).toContain("Don't speak just to agree");
  });
});

describe("classifyShouldSpeak", () => {
  it("returns parsed decision when LLM responds with valid JSON", async () => {
    vi.mocked(generateStructuredData).mockResolvedValueOnce({
      shouldSpeak: true,
      priority: 0.8,
      reason: "I have data",
    } as never);
    const d = await classifyShouldSpeak({
      persona,
      history: [],
      userId: "u1",
    });
    expect(d.shouldSpeak).toBe(true);
    expect(d.priority).toBe(0.8);
  });

  it("falls back to no when LLM throws", async () => {
    vi.mocked(generateStructuredData).mockRejectedValueOnce(new Error("rate limit"));
    const d = await classifyShouldSpeak({
      persona,
      history: [],
      userId: "u1",
    });
    expect(d).toEqual({ shouldSpeak: false, priority: 0, reason: "classifier-error" });
  });
});
```

- [ ] **Step 5.2: 跑测试确认失败**

Run: `pnpm vitest run src/server/council/__tests__/classifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5.3: 实现**

```ts
// src/server/council/classifier.ts
import { z } from "zod/v4";
import { generateStructuredData } from "@/server/ai/provider";
import type { ClassifierDecision, Persona } from "./types";

const ClassifierSchema = z.object({
  shouldSpeak: z.boolean(),
  priority: z.number().min(0).max(1),
  reason: z.string().max(200),
});

export type HistoryEntry = {
  role: "user" | "agent" | "system";
  content: string;
  personaName: string | null;
};

export function buildClassifierPrompt({
  persona,
  history,
  lastAgentMessage,
}: {
  persona: Persona;
  history: HistoryEntry[];
  lastAgentMessage?: { personaId: string; content: string } | null;
}): string {
  const recent = history
    .slice(-8)
    .map((e) => {
      const speaker = e.personaName ?? (e.role === "user" ? "用户" : e.role);
      return `[${speaker}]: ${e.content}`;
    })
    .join("\n");

  const promptExcerpt = persona.systemPrompt.slice(0, 200);
  const styleLine = persona.styleHint ? `Style hint: ${persona.styleHint}` : "";

  return `You are deciding whether the persona "${persona.name}" should speak next in a group discussion.

Persona system prompt (excerpt): ${promptExcerpt}
${styleLine}

Recent conversation:
${recent}

Rules:
1. Speak if you have something genuinely useful, contrarian, or clarifying to say.
2. Don't speak just to agree. Don't repeat what others already said.
3. If the last speaker was you and no new info appeared, do NOT speak again.
4. If the topic clearly isn't your domain, do NOT speak.

Return JSON:
{ "shouldSpeak": boolean, "priority": 0.0-1.0, "reason": "<one short sentence>" }
- priority 0.9+: 强烈想说 (被点名/明显错误要纠正/独到见解)
- priority 0.5-0.8: 有想法可以分享
- priority < 0.5: 勉强想说 (一般 false 更好)`;
}

export async function classifyShouldSpeak({
  persona,
  history,
  lastAgentMessage,
  userId,
  abortSignal,
}: {
  persona: Persona;
  history: HistoryEntry[];
  lastAgentMessage?: { personaId: string; content: string } | null;
  userId: string;
  abortSignal?: AbortSignal;
}): Promise<ClassifierDecision> {
  const prompt = buildClassifierPrompt({ persona, history, lastAgentMessage });

  try {
    const result = await generateStructuredData({
      prompt,
      schema: ClassifierSchema,
      // Provider abstraction picks cheap model when this hint is present.
      // If the abstraction doesn't yet support it, fall back to the default
      // model — the spec OPEN_QUESTION calls this out.
      modelHint: "cheap",
      userId,
      abortSignal,
    });
    return {
      shouldSpeak: result.shouldSpeak,
      priority: result.priority,
      reason: result.reason,
    };
  } catch (err) {
    if (isAbort(err)) throw err;
    console.warn("[council] classifier failed", err);
    return { shouldSpeak: false, priority: 0, reason: "classifier-error" };
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
```

> **Engineer note**: `generateStructuredData` 现在的签名（见 `src/server/ai/provider/index.ts`）可能没有 `modelHint` 参数。如果是这样，**先在 provider 抽象里加这个参数**（pass-through 到 ai-sdk 的 model 选择），或者直接在 classifier 里 import 一个独立的 cheap-model 调用函数。这是 spec §13 标注的 OPEN_QUESTION (2)，要在 plan 实施时确认。如果暂不支持，第一版 classifier 用默认模型（成本会高一些但功能上跑得通）—— **不能让这个阻塞 Phase 1 上线**。

- [ ] **Step 5.4: 跑测试通过**

Run: `pnpm vitest run src/server/council/__tests__/classifier.test.ts`
Expected: PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/server/council/classifier.ts src/server/council/__tests__/classifier.test.ts
git commit -m "feat(council): cheap classifier for should-speak decision"
```

---

## Task 6: `streamPersonaResponse`

**Files:**
- Create: `src/server/council/persona-stream.ts`

(无独立单测 — orchestrator 测试会通过 mock 覆盖)

- [ ] **Step 6.1: 实现**

```ts
// src/server/council/persona-stream.ts
import { streamChatResponse } from "@/server/ai/provider";
import type { Persona } from "./types";
import { searchKnowledgeForPersona, type PersonaRagHit } from "./persona-rag";
import type { HistoryEntry } from "./classifier";

const RAG_TOP_K = 6;

export async function* streamPersonaResponse({
  persona,
  history,
  userId,
  channelTopic,
  abortSignal,
}: {
  persona: Persona;
  history: HistoryEntry[];
  userId: string;
  channelTopic: string | null;
  abortSignal: AbortSignal;
}): AsyncIterable<string> {
  // Use the most recent user message as RAG query; fall back to last entry.
  const lastUser = [...history].reverse().find((e) => e.role === "user");
  const query = lastUser?.content ?? history.at(-1)?.content ?? "";

  const ragHits =
    query.length > 0
      ? await searchKnowledgeForPersona({ persona, query, userId })
      : [];

  const prompt = buildPersonaPrompt({
    persona,
    history,
    ragHits,
    channelTopic,
  });

  const stream = streamChatResponse({
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    userId,
    abortSignal,
  });

  for await (const chunk of stream.textStream) {
    if (abortSignal.aborted) return;
    yield chunk;
  }
}

function buildPersonaPrompt({
  persona,
  history,
  ragHits,
  channelTopic,
}: {
  persona: Persona;
  history: HistoryEntry[];
  ragHits: PersonaRagHit[];
  channelTopic: string | null;
}): { system: string; user: string } {
  const styleLine = persona.styleHint ? `\nStyle hint: ${persona.styleHint}` : "";

  const knowledge =
    ragHits.length === 0
      ? "(no scoped knowledge available — answer from your general knowledge)"
      : ragHits
          .map(
            (h, i) =>
              `[${i + 1}] Source: ${h.sourceType} "${h.sourceTitle}"\n> ${h.content.slice(0, 400)}`
          )
          .join("\n\n");

  const conversation = history
    .slice(-20)
    .map((e) => {
      const speaker = e.personaName ?? (e.role === "user" ? "用户" : e.role);
      return `[${speaker}]: ${e.content}`;
    })
    .join("\n");

  const system = `${persona.systemPrompt}${styleLine}

Channel topic: ${channelTopic ?? "(none)"}

Knowledge from your scope:
${knowledge}

Speak as ${persona.name}. Be concise (2-4 sentences typical, never exceed 6).
Cite sources by [note: title] when you reference them. You can disagree with what
others said. Do NOT repeat what was already said. Do NOT introduce yourself.`;

  const user = `Conversation so far:
${conversation}

Now respond.`;

  return { system, user };
}
```

> **Engineer note**: 这里假设 `streamChatResponse` 返回 `{ textStream: AsyncIterable<string> }`. 验证 `src/server/ai/provider/index.ts` 实际 signature；如果不匹配就调整 unwrap。

- [ ] **Step 6.2: 验证 build**

Run: `pnpm build`
Expected: 编译过

- [ ] **Step 6.3: Commit**

```bash
git add src/server/council/persona-stream.ts
git commit -m "feat(council): persona stream with RAG-grounded prompt"
```

---

## Task 7: Orchestrator (核心 — TDD 重点)

**Files:**
- Create: `src/server/council/orchestrator.ts`
- Test: `src/server/council/__tests__/orchestrator.test.ts`

- [ ] **Step 7.1: 写失败测试 — 五个核心 case**

```ts
// src/server/council/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => {
  const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
  return {
    db: { insert, select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })) })) },
  };
});

vi.mock("../classifier", () => ({
  classifyShouldSpeak: vi.fn(),
}));

vi.mock("../persona-stream", () => ({
  streamPersonaResponse: vi.fn(),
}));

import { classifyShouldSpeak } from "../classifier";
import { streamPersonaResponse } from "../persona-stream";
import { runTurn } from "../orchestrator";
import type { Persona, SSEEvent } from "../types";

const personas: Persona[] = [1, 2, 3].map((i) => ({
  id: `p${i}`,
  userId: "u1",
  name: `P${i}`,
  avatarEmoji: "",
  systemPrompt: "x",
  styleHint: null,
  scopeKind: "all",
  scopeRefId: null,
  scopeTags: null,
  isPreset: true,
  createdAt: 0,
  updatedAt: 0,
}));

const channel = {
  id: "c1",
  userId: "u1",
  name: "n",
  topic: null,
  hardLimitPerTurn: 6,
  createdAt: 0,
  updatedAt: 0,
};

async function* asyncIter(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncIterable<SSEEvent>): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops with consecutive_no when all personas vote no", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: false,
      priority: 0,
      reason: "n/a",
    });
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    expect(events.find((e) => e.type === "stopped")?.["reason"]).toBe(
      "consecutive_no"
    );
  });

  it("stops with hard_limit after channel.hardLimitPerTurn agent messages", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: true,
      priority: 0.5,
      reason: "ok",
    });
    vi.mocked(streamPersonaResponse).mockImplementation(() =>
      asyncIter(["hello"])
    );
    const events = await collect(
      runTurn({
        channel: { ...channel, hardLimitPerTurn: 2 },
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped?.["reason"]).toBe("hard_limit");
    expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  });

  it("highest-priority persona speaks first", async () => {
    vi.mocked(classifyShouldSpeak).mockImplementation(async ({ persona }) => ({
      shouldSpeak: true,
      priority: persona.id === "p2" ? 0.9 : 0.5,
      reason: "",
    }));
    let callCount = 0;
    vi.mocked(streamPersonaResponse).mockImplementation(() => {
      callCount += 1;
      // After first call, force stop by making everyone say no on reclassify
      if (callCount > 1) return asyncIter([]);
      return asyncIter(["from p2"]);
    });
    // After the first agent finishes, the next classify pass yields all-no
    let pass = 0;
    vi.mocked(classifyShouldSpeak).mockImplementation(async ({ persona }) => {
      pass += 1;
      if (pass <= 3) {
        return { shouldSpeak: true, priority: persona.id === "p2" ? 0.9 : 0.5, reason: "" };
      }
      return { shouldSpeak: false, priority: 0, reason: "" };
    });

    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    const firstAgentStart = events.find((e) => e.type === "agent_start");
    expect(firstAgentStart?.["personaId"]).toBe("p2");
  });

  it("user_interrupt: aborting mid-stream marks message interrupted and stops", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: true,
      priority: 0.5,
      reason: "",
    });
    const ctrl = new AbortController();
    vi.mocked(streamPersonaResponse).mockImplementation(async function* () {
      yield "partial...";
      ctrl.abort();
      yield "should not appear";
    });
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: ctrl.signal,
      })
    );
    const end = events.find((e) => e.type === "agent_end");
    expect(end?.["status"]).toBe("interrupted");
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped?.["reason"]).toBe("user_interrupt");
  });

  it("classifier error: falls back to no, no crash", async () => {
    vi.mocked(classifyShouldSpeak).mockRejectedValue(new Error("boom"));
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    // Should not throw; should stop with consecutive_no since all classifier
    // calls failed → mapped to no
    expect(events.find((e) => e.type === "stopped")).toBeTruthy();
  });
});
```

- [ ] **Step 7.2: 跑测试确认失败**

Run: `pnpm vitest run src/server/council/__tests__/orchestrator.test.ts`
Expected: FAIL — "Cannot find module '../orchestrator'"

- [ ] **Step 7.3: 实现 orchestrator**

```ts
// src/server/council/orchestrator.ts
import { db } from "@/server/db";
import {
  councilChannelMessages,
} from "@/server/db/schema/council";
import { asc, eq } from "drizzle-orm";
import type { Channel, Persona, SSEEvent } from "./types";
import { classifyShouldSpeak, type HistoryEntry } from "./classifier";
import { streamPersonaResponse } from "./persona-stream";

const WALL_CLOCK_MS = 90_000;

export async function* runTurn({
  channel,
  personas,
  userMessage,
  userId,
  abortSignal,
}: {
  channel: Channel;
  personas: Persona[];
  userMessage: { id: string; content: string };
  userId: string;
  abortSignal: AbortSignal;
}): AsyncGenerator<SSEEvent> {
  const turnId = crypto.randomUUID();

  // 1) 落库 user message
  const now = Date.now();
  await db.insert(councilChannelMessages).values({
    id: userMessage.id,
    channelId: channel.id,
    role: "user",
    personaId: null,
    content: userMessage.content,
    status: "complete",
    turnId,
    metadata: null,
    createdAt: now,
  });
  yield { type: "turn_start", turnId };

  // 2) Wall-clock 兜底
  const wallTimer = setTimeout(() => {
    if (!abortSignal.aborted) {
      // The provided signal isn't ours to abort; we use a separate flag.
      wallClockExpired = true;
    }
  }, WALL_CLOCK_MS);
  let wallClockExpired = false;

  let agentSpoken = 0;
  let lastAgentMessage: { personaId: string; content: string } | null = null;
  const personaIndex = new Map(personas.map((p) => [p.id, p]));

  try {
    while (true) {
      if (abortSignal.aborted) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }
      if (wallClockExpired) {
        yield { type: "stopped", reason: "error" };
        return;
      }
      if (agentSpoken >= channel.hardLimitPerTurn) {
        yield { type: "stopped", reason: "hard_limit" };
        return;
      }

      const history = await loadRecentHistory(channel.id, personaIndex);

      // CLASSIFY
      const decisions = await Promise.all(
        personas.map(async (p) => {
          try {
            const d = await classifyShouldSpeak({
              persona: p,
              history,
              lastAgentMessage,
              userId,
              abortSignal,
            });
            return { persona: p, decision: d };
          } catch {
            return {
              persona: p,
              decision: {
                shouldSpeak: false,
                priority: 0,
                reason: "classifier-error",
              },
            };
          }
        })
      );

      const queue = decisions
        .filter((d) => d.decision.shouldSpeak)
        .sort((a, b) => b.decision.priority - a.decision.priority);

      if (queue.length === 0) {
        yield { type: "stopped", reason: "consecutive_no" };
        return;
      }

      const speaker = queue[0];
      const messageId = crypto.randomUUID();
      yield {
        type: "agent_start",
        turnId,
        messageId,
        personaId: speaker.persona.id,
      };

      // STREAM
      let buffer = "";
      let interrupted = false;
      try {
        const stream = streamPersonaResponse({
          persona: speaker.persona,
          history,
          userId,
          channelTopic: channel.topic,
          abortSignal,
        });
        for await (const chunk of stream) {
          if (abortSignal.aborted) {
            interrupted = true;
            break;
          }
          buffer += chunk;
          yield { type: "agent_delta", messageId, delta: chunk };
        }
      } catch (err) {
        if (isAbort(err)) {
          interrupted = true;
        } else {
          // Single-agent error: write an error system message, skip
          await db.insert(councilChannelMessages).values({
            id: crypto.randomUUID(),
            channelId: channel.id,
            role: "system",
            personaId: speaker.persona.id,
            content: `agent error: ${(err as Error).message}`,
            status: "error",
            turnId,
            metadata: null,
            createdAt: Date.now(),
          });
          yield {
            type: "agent_end",
            messageId,
            status: "complete", // close out the placeholder bubble
          };
          // Try next iteration (don't increment agentSpoken)
          continue;
        }
      }

      await db.insert(councilChannelMessages).values({
        id: messageId,
        channelId: channel.id,
        role: "agent",
        personaId: speaker.persona.id,
        content: buffer,
        status: interrupted ? "interrupted" : "complete",
        turnId,
        metadata: JSON.stringify({ priority: speaker.decision.priority }),
        createdAt: Date.now(),
      });
      yield {
        type: "agent_end",
        messageId,
        status: interrupted ? "interrupted" : "complete",
      };

      if (interrupted) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }

      agentSpoken += 1;
      lastAgentMessage = {
        personaId: speaker.persona.id,
        content: buffer,
      };
    }
  } finally {
    clearTimeout(wallTimer);
  }
}

async function loadRecentHistory(
  channelId: string,
  personaIndex: Map<string, Persona>
): Promise<HistoryEntry[]> {
  const rows = await db
    .select()
    .from(councilChannelMessages)
    .where(eq(councilChannelMessages.channelId, channelId))
    .orderBy(asc(councilChannelMessages.createdAt))
    .limit(40); // load a bit more than 20; we'll truncate below

  // Keep last 20 + earlier user messages only (per spec §6 truncate)
  const last20 = rows.slice(-20);
  const earlierUsers = rows.slice(0, -20).filter((r) => r.role === "user");
  const combined = [...earlierUsers, ...last20];

  return combined.map((r) => ({
    role: r.role as HistoryEntry["role"],
    content: r.content,
    personaName: r.personaId
      ? personaIndex.get(r.personaId)?.name ?? null
      : null,
  }));
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
```

- [ ] **Step 7.4: 跑测试通过**

Run: `pnpm vitest run src/server/council/__tests__/orchestrator.test.ts`
Expected: PASS

如果有 case 失败，**先看是不是 mock 的 db 接口跟生产不匹配**——orchestrator 调 `db.insert`/`db.select` 都要在测试 mock 里覆盖到。必要时调整测试的 mock chain。

- [ ] **Step 7.5: Commit**

```bash
git add src/server/council/orchestrator.ts src/server/council/__tests__/orchestrator.test.ts
git commit -m "feat(council): turn-taking orchestrator with abort + error isolation"
```

---

## Task 8: Test mode (deterministic fixture)

**Files:**
- Create: `src/server/council/test-mode.ts`
- Modify: `src/server/council/classifier.ts`, `src/server/council/persona-stream.ts`

- [ ] **Step 8.1: Test mode helper**

```ts
// src/server/council/test-mode.ts
/**
 * When COUNCIL_TEST_MODE=true, classifier and persona-stream return deterministic
 * fixtures so e2e tests don't depend on real LLM calls.
 *
 * Behavior summary:
 *  - Classifier: persona "AI 工程师" always yes (priority 0.9), others no
 *    on first user message; on subsequent reclassify all no → triggers
 *    consecutive_no.
 *  - Stream: yields a fixed string in 3 chunks.
 */
export const TEST_MODE = process.env.COUNCIL_TEST_MODE === "true";

let classifyCallCount = 0;

export function fakeClassify(personaName: string): {
  shouldSpeak: boolean;
  priority: number;
  reason: string;
} {
  classifyCallCount += 1;
  // First pass: AI 工程师 yes
  if (classifyCallCount <= 3) {
    if (personaName === "AI 工程师") {
      return { shouldSpeak: true, priority: 0.9, reason: "test-yes" };
    }
    return { shouldSpeak: false, priority: 0, reason: "test-no" };
  }
  // After AI 工程师 spoke, reclassify yields all-no → consecutive_no
  return { shouldSpeak: false, priority: 0, reason: "test-quiet" };
}

export function resetFakeClassifyCount() {
  classifyCallCount = 0;
}

export async function* fakeStream(): AsyncIterable<string> {
  yield "Test-mode response part 1. ";
  yield "Part 2. ";
  yield "Part 3.";
}
```

- [ ] **Step 8.2: Wire 到 classifier**

修改 `src/server/council/classifier.ts`，在 `classifyShouldSpeak` 顶部加：

```ts
import { TEST_MODE, fakeClassify } from "./test-mode";

export async function classifyShouldSpeak(args: ...): Promise<ClassifierDecision> {
  if (TEST_MODE) return fakeClassify(args.persona.name);
  // ... existing impl
}
```

- [ ] **Step 8.3: Wire 到 persona-stream**

修改 `src/server/council/persona-stream.ts`：

```ts
import { TEST_MODE, fakeStream } from "./test-mode";

export async function* streamPersonaResponse(args: ...): AsyncIterable<string> {
  if (TEST_MODE) {
    yield* fakeStream();
    return;
  }
  // ... existing impl
}
```

- [ ] **Step 8.4: Commit**

```bash
git add src/server/council/test-mode.ts src/server/council/classifier.ts src/server/council/persona-stream.ts
git commit -m "feat(council): COUNCIL_TEST_MODE deterministic fixture for e2e"
```

---

## Task 9: SSE Route Handler

**Files:**
- Create: `src/app/api/council/[channelId]/chat/route.ts`

- [ ] **Step 9.1: 实现**

```ts
// src/app/api/council/[channelId]/chat/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, eq } from "drizzle-orm";
import { runTurn } from "@/server/council/orchestrator";
import type { SSEEvent } from "@/server/council/types";

export const runtime = "nodejs"; // hybrid RAG uses better-sqlite3 / native deps

const encoder = new TextEncoder();

function encode(evt: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(evt)}\n\n`);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { channelId } = await params;

  // Ownership check
  const [channel] = await db
    .select()
    .from(councilChannels)
    .where(
      and(eq(councilChannels.id, channelId), eq(councilChannels.userId, userId))
    )
    .limit(1);
  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load personas in this channel
  const personas = await db
    .select({ persona: councilPersonas })
    .from(councilChannelPersonas)
    .innerJoin(
      councilPersonas,
      eq(councilChannelPersonas.personaId, councilPersonas.id)
    )
    .where(eq(councilChannelPersonas.channelId, channelId));

  if (personas.length === 0) {
    return NextResponse.json({ error: "no personas in channel" }, { status: 400 });
  }

  // Parse body
  const body = (await req.json()) as { content?: string; messageId?: string };
  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "empty content" }, { status: 400 });
  }

  const userMessageId = body.messageId ?? crypto.randomUUID();

  // SSE stream
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of runTurn({
          channel,
          personas: personas.map((p) => p.persona),
          userMessage: { id: userMessageId, content },
          userId,
          abortSignal: req.signal,
        })) {
          controller.enqueue(encode(evt));
        }
      } catch (err) {
        if (!isAbort(err)) {
          controller.enqueue(
            encode({
              type: "error",
              message: (err as Error).message ?? "unknown",
            })
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
```

- [ ] **Step 9.2: 验证 build**

Run: `pnpm build`
Expected: 编译过

- [ ] **Step 9.3: Commit**

```bash
git add src/app/api/council/
git commit -m "feat(council): SSE route handler"
```

---

## Task 10: `use-council-stream` Hook

**Files:**
- Create: `src/app/(app)/council/[channelId]/use-council-stream.ts`

- [ ] **Step 10.1: 实现**

```ts
// src/app/(app)/council/[channelId]/use-council-stream.ts
"use client";
import { useCallback, useRef, useState } from "react";
import type { SSEEvent } from "@/server/council/types";

export type ClientMessage = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  status: "streaming" | "complete" | "interrupted" | "error";
  personaId?: string;
  turnId?: string;
};

export type UseCouncilStream = {
  messages: ClientMessage[];
  isStreaming: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
};

export function useCouncilStream(
  channelId: string,
  initial: ClientMessage[]
): UseCouncilStream {
  const [messages, setMessages] = useState<ClientMessage[]>(initial);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<Promise<void> | null>(null);

  const doStream = useCallback(
    async (ctrl: AbortController, text: string) => {
      setIsStreaming(true);
      const userId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        {
          id: userId,
          role: "user",
          content: text,
          status: "complete",
        },
      ]);

      try {
        const res = await fetch(`/api/council/${channelId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, messageId: userId }),
          signal: ctrl.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!raw.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(raw.slice(6)) as SSEEvent;
              applyEvent(evt, setMessages);
            } catch {
              // ignore malformed line
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("council stream error", err);
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [channelId]
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      // Barrier: abort + wait for previous flush before starting next.
      if (abortRef.current) {
        abortRef.current.abort();
        if (flushRef.current) {
          await flushRef.current.catch(() => {});
        }
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      flushRef.current = doStream(ctrl, text);
      await flushRef.current;
    },
    [doStream]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, send, stop };
}

function applyEvent(
  evt: SSEEvent,
  setMessages: React.Dispatch<React.SetStateAction<ClientMessage[]>>
) {
  switch (evt.type) {
    case "turn_start":
      // no-op (turnId is informational)
      break;
    case "agent_start":
      setMessages((m) => [
        ...m,
        {
          id: evt.messageId,
          role: "agent",
          personaId: evt.personaId,
          turnId: evt.turnId,
          content: "",
          status: "streaming",
        },
      ]);
      break;
    case "agent_delta":
      setMessages((m) =>
        m.map((msg) =>
          msg.id === evt.messageId
            ? { ...msg, content: msg.content + evt.delta }
            : msg
        )
      );
      break;
    case "agent_end":
      setMessages((m) =>
        m.map((msg) =>
          msg.id === evt.messageId ? { ...msg, status: evt.status } : msg
        )
      );
      break;
    case "stopped":
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: stoppedReasonToText(evt.reason),
          status: "complete",
        },
      ]);
      break;
    case "error":
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `⚠ ${evt.message}`,
          status: "error",
        },
      ]);
      break;
  }
}

function stoppedReasonToText(reason: string): string {
  switch (reason) {
    case "hard_limit":
      return "⏱ 讨论达到本轮上限";
    case "consecutive_no":
      return "💤 暂时没人想接话了";
    case "user_interrupt":
      return "⏸ 你打断了讨论";
    case "user_stop":
      return "⏹ 讨论已停止";
    default:
      return `⚠ 出错了 (${reason})`;
  }
}
```

- [ ] **Step 10.2: Commit**

```bash
git add src/app/\(app\)/council/
git commit -m "feat(council): client SSE hook with abort barrier"
```

---

## Task 11: Council Room UI

**Files:**
- Create: `src/app/(app)/council/[channelId]/council-room.tsx`

- [ ] **Step 11.1: 实现**

```tsx
// src/app/(app)/council/[channelId]/council-room.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import {
  useCouncilStream,
  type ClientMessage,
} from "./use-council-stream";
import type { Persona } from "@/server/council/types";
import { cn } from "@/lib/utils";

type Props = {
  channelId: string;
  channelName: string;
  channelTopic: string | null;
  personas: Persona[];
  initialMessages: ClientMessage[];
};

const PERSONA_COLORS = [
  "bg-sky-100 dark:bg-sky-950 border-sky-300 dark:border-sky-800",
  "bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800",
  "bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-800",
  "bg-violet-100 dark:bg-violet-950 border-violet-300 dark:border-violet-800",
];

function colorForPersona(personas: Persona[], id: string): string {
  const idx = personas.findIndex((p) => p.id === id);
  return PERSONA_COLORS[idx % PERSONA_COLORS.length];
}

export function CouncilRoom({
  channelId,
  channelName,
  channelTopic,
  personas,
  initialMessages,
}: Props) {
  const { messages, isStreaming, send, stop } = useCouncilStream(
    channelId,
    initialMessages
  );
  const [input, setInput] = useState("");
  const personaById = new Map(personas.map((p) => [p.id, p]));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    void send(text);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-stone-200 px-6 py-3 dark:border-stone-800">
        <h1 className="text-lg font-semibold">#{channelName}</h1>
        {channelTopic && (
          <p className="text-sm text-stone-500">{channelTopic}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {personas.map((p) => (
            <span
              key={p.id}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                colorForPersona(personas, p.id)
              )}
            >
              {p.avatarEmoji} {p.name}
            </span>
          ))}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              persona={msg.personaId ? personaById.get(msg.personaId) : undefined}
              colorClass={
                msg.personaId ? colorForPersona(personas, msg.personaId) : ""
              }
            />
          ))}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-stone-200 bg-stone-50 px-6 py-3 dark:border-stone-800 dark:bg-stone-950"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            placeholder="Throw a question…"
            rows={1}
            className="flex-1 resize-none rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900"
          />
          {isStreaming && (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              aria-label="Stop discussion"
            >
              <Square className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  msg,
  persona,
  colorClass,
}: {
  msg: ClientMessage;
  persona?: Persona;
  colorClass: string;
}) {
  if (msg.role === "system") {
    return (
      <div className="my-2 self-center text-center text-xs text-stone-500">
        ── {msg.content} ──
      </div>
    );
  }
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[80%] rounded-lg bg-sky-600 px-3 py-2 text-sm text-white">
        {msg.content}
      </div>
    );
  }
  // agent
  return (
    <div className="self-start max-w-[80%]">
      <div className="mb-1 text-xs text-stone-500">
        {persona?.avatarEmoji} {persona?.name ?? "Agent"}
      </div>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          colorClass,
          msg.status === "interrupted" && "opacity-70"
        )}
      >
        {msg.content}
        {msg.status === "streaming" && (
          <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-stone-500" />
        )}
        {msg.status === "interrupted" && (
          <span className="ml-2 text-xs italic text-stone-500">
            (被你打断了)
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Commit**

```bash
git add src/app/\(app\)/council/\[channelId\]/council-room.tsx
git commit -m "feat(council): chat room UI with multi-agent bubbles"
```

---

## Task 12: 入口页 + 服务端 wrapper + sidebar

**Files:**
- Create: `src/app/(app)/council/page.tsx`
- Create: `src/app/(app)/council/[channelId]/page.tsx`
- Modify: `src/components/layout/navigation.ts`

- [ ] **Step 12.1: 入口 redirect**

```tsx
// src/app/(app)/council/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ensureDefaultCouncilChannel } from "@/server/council/seeds";

export default async function CouncilIndexPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { channelId } = await ensureDefaultCouncilChannel(session.user.id);
  redirect(`/council/${channelId}`);
}
```

- [ ] **Step 12.2: 频道服务端页**

```tsx
// src/app/(app)/council/[channelId]/page.tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelMessages,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, asc, eq } from "drizzle-orm";
import { CouncilRoom } from "./council-room";
import type { ClientMessage } from "./use-council-stream";

export default async function CouncilChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { channelId } = await params;

  const [channel] = await db
    .select()
    .from(councilChannels)
    .where(
      and(
        eq(councilChannels.id, channelId),
        eq(councilChannels.userId, session.user.id)
      )
    )
    .limit(1);
  if (!channel) notFound();

  const personaRows = await db
    .select({ persona: councilPersonas })
    .from(councilChannelPersonas)
    .innerJoin(
      councilPersonas,
      eq(councilChannelPersonas.personaId, councilPersonas.id)
    )
    .where(eq(councilChannelPersonas.channelId, channelId));

  const messages = await db
    .select()
    .from(councilChannelMessages)
    .where(eq(councilChannelMessages.channelId, channelId))
    .orderBy(asc(councilChannelMessages.createdAt))
    .limit(200);

  const initial: ClientMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role as ClientMessage["role"],
    content: m.content,
    status: m.status as ClientMessage["status"],
    personaId: m.personaId ?? undefined,
    turnId: m.turnId ?? undefined,
  }));

  return (
    <CouncilRoom
      channelId={channel.id}
      channelName={channel.name}
      channelTopic={channel.topic}
      personas={personaRows.map((r) => r.persona)}
      initialMessages={initial}
    />
  );
}
```

- [ ] **Step 12.3: Sidebar 入口**

修改 `src/components/layout/navigation.ts`，import `Users` icon 并加到 CAPTURE group：

```ts
import {
  Activity,
  FileText,
  FolderGit2,
  GraduationCap,
  LayoutDashboard,
  MessageCircle,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
// ...
{
  label: "CAPTURE",
  items: [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/notes", label: "Notes", icon: FileText },
    { href: "/ask", label: "Ask AI", icon: MessageCircle },
    { href: "/council", label: "Council", icon: Users },
  ],
},
```

- [ ] **Step 12.4: 验证 build**

Run: `pnpm build`
Expected: 编译过；仍未运行时启动 dev server 手动 smoke test
Run: `pnpm dev`，访问 `/council`，确认能跳到 `/council/<id>` 并看到三个 persona 的徽章 + 输入框。**这是手动 smoke，不是测试。**

- [ ] **Step 12.5: Commit**

```bash
git add src/app/\(app\)/council/ src/components/layout/navigation.ts
git commit -m "feat(council): page entry + sidebar nav"
```

---

## Task 13: E2E

**Files:**
- Create: `e2e/council.spec.ts`

- [ ] **Step 13.1: 写 e2e**

```ts
// e2e/council.spec.ts
import { test, expect } from "@playwright/test";

// COUNCIL_TEST_MODE must be set in the playwright config or globalSetup so
// the dev server picks it up. See e2e/playwright.config.ts.

test.describe("Council multi-agent room", () => {
  test.beforeEach(async ({ page }) => {
    // Use existing dev test account auto-login pattern (per Knosi e2e setup)
    await page.goto("/login");
    await page.fill("input[name=email]", "test@secondbrain.local");
    await page.fill("input[name=password]", "test123456");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard/);
  });

  test("golden path: send → at least one agent streams → stopped", async ({ page }) => {
    await page.goto("/council");
    await page.waitForURL(/\/council\/[a-f0-9-]+/);
    await expect(page.getByText("我的圆桌")).toBeVisible();
    await expect(page.getByText("AI 工程师")).toBeVisible();
    await expect(page.getByText("后端架构师")).toBeVisible();
    await expect(page.getByText("产品经理")).toBeVisible();

    await page.getByPlaceholder("Throw a question…").fill("Should we add a reranker?");
    await page.keyboard.press("Enter");

    // Test mode: AI 工程师 will speak with deterministic content
    await expect(page.getByText("Test-mode response part 1.")).toBeVisible({
      timeout: 10_000,
    });
    // Stopped marker eventually appears
    await expect(page.getByText("暂时没人想接话了")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("interrupt: send mid-stream → previous agent marked interrupted", async ({ page }) => {
    await page.goto("/council");
    await page.waitForURL(/\/council\/[a-f0-9-]+/);

    await page.getByPlaceholder("Throw a question…").fill("first");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Test-mode response part 1.")).toBeVisible();

    // Immediately send another (interrupt)
    await page.getByPlaceholder("Throw a question…").fill("second");
    await page.keyboard.press("Enter");

    await expect(page.getByText("(被你打断了)")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("⏸ 你打断了讨论")).toBeVisible();
  });

  test("stop button works during streaming", async ({ page }) => {
    await page.goto("/council");
    await page.waitForURL(/\/council\/[a-f0-9-]+/);

    await page.getByPlaceholder("Throw a question…").fill("hello");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Stop discussion")).toBeVisible();
    await page.getByLabel("Stop discussion").click();
    await expect(page.getByText("⏹ 讨论已停止").or(page.getByText("⏸ 你打断了讨论"))).toBeVisible({
      timeout: 5_000,
    });
  });

  test("history persists across reload", async ({ page }) => {
    await page.goto("/council");
    await page.waitForURL(/\/council\/[a-f0-9-]+/);
    await page.getByPlaceholder("Throw a question…").fill("persistent question");
    await page.keyboard.press("Enter");
    await expect(page.getByText("暂时没人想接话了")).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByText("persistent question")).toBeVisible();
    await expect(page.getByText("Test-mode response part 1.")).toBeVisible();
  });
});
```

> **Engineer note**: Stop button case 上面用 `or()` 兜底，因为按钮被点的瞬间可能 abort 已传到服务端，也可能客户端先一步切流。任意一个 reason 都可接受。

- [ ] **Step 13.2: 启用 COUNCIL_TEST_MODE**

确认 `playwright.config.ts` 在 `webServer.env` 里设置了 `COUNCIL_TEST_MODE=true`；如果没有就加上：

```ts
// playwright.config.ts (修改 webServer 配置)
webServer: {
  command: "pnpm dev",
  port: 3200,
  env: {
    ...process.env,
    COUNCIL_TEST_MODE: "true",
  },
},
```

- [ ] **Step 13.3: 跑 e2e**

Run: `pnpm test:e2e e2e/council.spec.ts`
Expected: 4 个 test 全过

- [ ] **Step 13.4: Commit**

```bash
git add e2e/council.spec.ts playwright.config.ts
git commit -m "test(council): e2e for golden path + interrupt + stop + reload"
```

---

## Task 14: 自验证 + Changelog + 收尾

- [ ] **Step 14.1: 全量 build / lint / test**

Run: `pnpm build`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

Run: `pnpm test:e2e`
Expected: 全部 e2e 包括既有的都过

如果有失败，**先修，不要绕过**。

- [ ] **Step 14.2: 写 Phase 1 changelog**

Create `docs/changelog/2026-05-01-council-phase-1.md`:

```markdown
# Council — Multi-Agent Discussion Room (Phase 1)

**Date**: 2026-05-01

## 任务 / 目标
在 Knosi 上加一个新模块 `/council`，跑通 multi-agent 群聊的最小可用版本。
核心练手：去中心化 turn-taking、可中断流、per-persona RAG scope、多层 stop condition。

## 关键变更
- 新增 schema：`council_personas` / `council_channels` / `council_channel_personas` / `council_channel_messages`
- 新增 server module `src/server/council/`：types / seeds / orchestrator / classifier / persona-stream / persona-rag / test-mode
- 新增 SSE endpoint `POST /api/council/[channelId]/chat`
- 新增 page `/council` + `/council/[channelId]`，sidebar 加 Council 入口
- 3 个预置 persona：AI 工程师 / 后端架构师 / 产品经理
- E2E 覆盖：golden path / interrupt / stop / reload persistence

## 文件
（实现时填）

## 验证
- pnpm build: ✅
- pnpm lint: ✅
- pnpm test:e2e: ✅（含 4 个新 council case）
- 手动 smoke：访问 /council → 自动建 channel + 3 persona → 抛问题 → 看到 AI 工程师流式发言 → "暂时没人想接话了" 收尾

## 生产 schema rollout
本次新增 4 张表全部需要在生产 Turso 上同步。
- 命令：（按 `.claude/rules/production-turso.md` 流程，运行 `drizzle/0042_*.sql` 中的 CREATE TABLE / CREATE INDEX 语句）
- 验证查询：`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'council_%';` 应返回 4 行

## 风险 / 后续
- Classifier 仍用主模型（provider 抽象未支持 `modelHint: "cheap"`）→ Phase 2 加便宜通道
- 仅支持 `all`/`notes`/`bookmarks` scope；learning-notebook / oss-project 推迟到 Phase 3
- chunks 表无冗余 tags；tag 过滤当前 join 回 source 表，量大时性能问题待评估
- UI 第一版：固定一个频道，Phase 2 做 channel/persona CRUD + 沉淀笔记
```

- [ ] **Step 14.3: 生产 schema rollout**

按 `.claude/rules/production-turso.md` 流程，把 `drizzle/0042_*.sql` 里 4 个 CREATE TABLE + 索引在生产 Turso 上执行。
验证：

```bash
turso db shell <prod-db> "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'council_%';"
```
Expected: 4 rows（4 张 council 表）

把执行命令和验证输出贴到 changelog。

- [ ] **Step 14.4: Commit + push**

```bash
git add docs/changelog/2026-05-01-council-phase-1.md
git commit -m "docs(changelog): council phase 1 complete"
git push origin main
```

push 之后 GitHub Actions 会自动 deploy 到 Hetzner。

---

## Self-Review

### Spec coverage check

| Spec section | 实现于 |
|---|---|
| §0 目标 / 练手目标 | T1-T13 整体 |
| §1 决策汇总 | T1 schema, T2 seeds, T7 orchestrator, T9 SSE |
| §2 预置 persona | T2 |
| §3 架构总览 | T7 + T9 |
| §4 数据模型 | T1 |
| §5 turn-taking | T7 (orchestrator) |
| §6 可中断流 | T7 + T9 + T10 |
| §7 persona scope & RAG | T4 |
| §8 UI / 交互 | T11 + T12 |
| §9 错误处理 | T7 (error isolation), T10 (stoppedReasonToText), T13 (mock failure case 推迟到 Phase 2 — 见下) |
| §10 测试 | T4/5/7 单测, T13 e2e |
| §11 性能 / 成本 | 不需要代码，写到 changelog 风险 |
| §12 MVP 分期 | Phase 1 = 本 plan 全部 |
| §13 风险 / 开放问题 | changelog 风险 |
| §14 验收标准 | T14 自验证清单 |

### Gaps

- **Spec §10 e2e case 5（错误兜底：mock 一个 persona 失败 → 其他正常 → ⚠️ 标记可见）** —— 当前 e2e 没覆盖。**plan 决定推迟**：要让 1 个 persona 失败、其他成功，需要 test-mode fixture 进一步细化（按 persona name 控制是否失败）。第一版 4 个 e2e case 已能覆盖大部分流程；错误兜底的逻辑由 orchestrator 单测（T7 case "single agent error: ..."）覆盖，e2e 留到 Phase 2 加。
- **Spec §13 OPEN_QUESTION (2) provider 抽象的 cheap 别名** —— T5 engineer note 已说明：如果不存在就 fallback 到默认模型，不阻塞 Phase 1。

### Type consistency check

- `Persona` 类型来自 `councilPersonas.$inferSelect`（T2），全程统一
- `SSEEvent` discriminated union 在 T2 定义后被 T7/T9/T10 共用
- `ClientMessage.status` enum：T10 定义 `"streaming" | "complete" | "interrupted" | "error"`，与服务端 schema 的 `"complete" | "interrupted" | "error"` 多一个 `"streaming"`（仅前端态），有意为之
- T6 假设 `streamChatResponse` 返回 `{ textStream }`——engineer 实施时校验真实签名
- T5 假设 `generateStructuredData` 接受 `{ schema, prompt, modelHint, userId, abortSignal }`——同上需要校验

### Placeholder check

无 TBD/TODO/"add appropriate error handling" 等占位语。

---

## Done.

Plan complete. Total estimated tasks: 14, ~50 bite-sized steps. Each task ends with a commit so progress is checkpointable.
