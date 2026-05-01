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
 * Idempotent: returns existing default channel or creates it with 3 preset personas.
 */
export async function ensureDefaultCouncilChannel(userId: string): Promise<{
  channelId: string;
  isNew: boolean;
}> {
  const now = Date.now();

  // 1. existing channel?
  const existing = await db
    .select()
    .from(councilChannels)
    .where(eq(councilChannels.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    return { channelId: existing[0].id, isNew: false };
  }

  // 2. ensure preset personas
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

  // 3. create channel + link personas
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
