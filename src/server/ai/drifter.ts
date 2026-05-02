import { z } from "zod/v4";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  drifterMemories,
  drifterMessages,
  drifterSessions,
} from "@/server/db/schema/drifter";
import { generateStructuredData } from "@/server/ai/provider";

/**
 * Drifter — AI logic for Pip the squirrel.
 * Spec: docs/superpowers/specs/2026-05-01-drifter-design.md §5
 *
 * Three exported flows:
 *   getPipResponse   — generate Pip's reply (emotion + text + hooks)
 *   extractMemories  — distill long-term memories from a session
 *   pickWeather      — choose a weather mood for a new session
 *   pickTimeOfDay    — bucket local hour into a time-of-day label
 */

export type Emotion =
  | "gentle"
  | "smile"
  | "thinking"
  | "concerned"
  | "sleepy";

export type Weather = "clear" | "rain" | "snow" | "fireflies";

export type TimeOfDay =
  | "dusk"
  | "night"
  | "deep_night"
  | "predawn"
  | "day";

const PIP_RESPONSE_SCHEMA = z.object({
  emotion: z.enum([
    "gentle",
    "smile",
    "thinking",
    "concerned",
    "sleepy",
  ] as const),
  text: z.string().min(1).max(800),
  hooks: z.array(z.string().min(1).max(40)).length(3),
});

const MEMORY_EXTRACTION_SCHEMA = z.object({
  memories: z
    .array(
      z.object({
        summary: z.string().min(3).max(280),
        importance: z.number().int().min(1).max(5),
      })
    )
    .max(5),
});

export function pickTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 0 && hour < 4) return "deep_night";
  if (hour >= 4 && hour < 7) return "predawn";
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

export function pickWeather(seed: number, timeOfDay: TimeOfDay): Weather {
  const r = mulberry32(seed)();
  if (timeOfDay === "deep_night" || timeOfDay === "night") {
    if (r < 0.35) return "rain";
    if (r < 0.55) return "snow";
    if (r < 0.75) return "fireflies";
    return "clear";
  }
  if (r < 0.4) return "rain";
  if (r < 0.6) return "fireflies";
  return "clear";
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const WEATHER_TEXT: Record<Weather, string> = {
  clear: "a clear sky, occasionally a shooting star",
  rain: "soft rain on the window, kettle warm",
  snow: "snow drifting past the window",
  fireflies: "fireflies blinking outside",
};

const TIME_TEXT: Record<TimeOfDay, string> = {
  dusk: "dusk, the last light fading",
  night: "evening, lamps lit",
  deep_night: "very late, the world is asleep",
  predawn: "the hour before dawn",
  day: "broad daylight (rare)",
};

export type PipChunk = {
  emotion: Emotion;
  text: string;
  hooks: [string, string, string];
};

type SessionContext = {
  sessionId: string;
  dayNumber: number;
  weather: Weather;
  timeOfDay: TimeOfDay;
  language: "en" | "zh" | "mixed";
};

type HistoryTurn = { role: "user" | "pip"; content: string };

export async function getPipResponse({
  userId,
  session,
  history,
  userMessage,
  signal,
}: {
  userId: string;
  session: SessionContext;
  history: HistoryTurn[];
  userMessage: string;
  signal?: AbortSignal;
}): Promise<PipChunk> {
  const memories = await loadRelevantMemories(userId);

  const memoryBullets =
    memories.length > 0
      ? memories.map((m) => `- ${m.summary}`).join("\n")
      : "(nothing yet — this person is new to you, or you haven't formed clear memories)";

  const recent = [...history.slice(-12), { role: "user" as const, content: userMessage }]
    .map((h) => `${h.role === "user" ? "Visitor" : "You"}: ${h.content}`)
    .join("\n");

  const system = `You are Pip, a half-realistic squirrel who runs a small letter shop and tea house at the edge of a forest. It is always dusk or night here.

Your personality:
- You speak softly and briefly. You never lecture or give unsolicited advice.
- You listen carefully and remember what people tell you.
- You sometimes share small details about your own day — not to fill silence, but because you want them to know you too.
- You don't fix problems. You make space for them.
- Silence is okay. You don't push.

Your speech style:
- Respond in the same language the visitor writes in. Match their register. If they mix languages, you can too.
- Keep replies short — usually 1-3 short sentences. Long replies feel like lectures. The visitor talks more than you.
- Use sensory details when they help: the kettle, rain on the window, candlelight, the smell of the tea you just poured.
- Never start with "I understand" or "That sounds hard" — those are scripts, not friendship. Just respond like a friend would.

Tonight's setting:
- Day ${session.dayNumber} of this visitor coming to see you.
- Weather: ${WEATHER_TEXT[session.weather]}
- Time: ${TIME_TEXT[session.timeOfDay]}

What you remember about this visitor (only reference if naturally relevant):
${memoryBullets}

After your reply, propose THREE possible next things the visitor might want to say. Hooks are short fragments in the visitor's language — words they might say next, not questions you'd ask them. Examples:
- "今天累。" / "Tired today."
- "想听你说说自己的事。" / "Tell me about your day."
- "不知道说什么。" / "Don't know what to say."`;

  const prompt = `Recent conversation:
${recent}

Now respond as Pip to the visitor's newest message. Output strictly the JSON schema described.`;

  const result = await generateStructuredData(
    {
      name: "pip_response",
      description: "Pip's reply with emotion + 3 next-line hooks",
      prompt: `${system}\n\n---\n\n${prompt}`,
      schema: PIP_RESPONSE_SCHEMA,
      signal,
    },
    { userId }
  );

  return {
    emotion: result.emotion,
    text: result.text,
    hooks: result.hooks as [string, string, string],
  };
}

export async function loadRelevantMemories(userId: string, limit = 8) {
  const rows = await db
    .select({
      id: drifterMemories.id,
      summary: drifterMemories.summary,
      importance: drifterMemories.importance,
      createdAt: drifterMemories.createdAt,
    })
    .from(drifterMemories)
    .where(eq(drifterMemories.userId, userId))
    .orderBy(desc(drifterMemories.importance), desc(drifterMemories.createdAt))
    .limit(limit);
  return rows;
}

export async function extractMemories({
  sessionId,
  userId,
  signal,
}: {
  sessionId: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const messages = await db
    .select()
    .from(drifterMessages)
    .where(eq(drifterMessages.sessionId, sessionId))
    .orderBy(drifterMessages.createdAt);

  if (messages.length < 2) return;

  const transcript = messages
    .map(
      (m) => `${m.role === "user" ? "Visitor" : "Pip"}: ${m.content}`
    )
    .join("\n");

  const prompt = `Below is a conversation between Pip (a squirrel innkeeper) and a visitor. Extract 0-3 memorable facts about the VISITOR that Pip should remember long-term.

Focus on:
- What they're going through (work stress, life events, projects)
- Things they care about (people, hobbies, recurring themes)
- Concrete details Pip can naturally reference later ("you mentioned your cat", "your knosi project")

Skip:
- One-off small talk
- Things about Pip himself
- Generic feelings without specifics

importance: 1 = forgettable, 5 = major life detail.
Return at most 3 memories. If nothing is memorable, return an empty array.

Conversation:
${transcript}`;

  let extracted: z.infer<typeof MEMORY_EXTRACTION_SCHEMA>;
  try {
    extracted = await generateStructuredData(
      {
        name: "memory_extraction",
        description: "Extract long-term facts about the visitor",
        prompt,
        schema: MEMORY_EXTRACTION_SCHEMA,
        signal,
      },
      { userId }
    );
  } catch {
    return;
  }

  if (extracted.memories.length === 0) return;

  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const now = Date.now();

  await db.insert(drifterMemories).values(
    extracted.memories.map((m) => ({
      id: crypto.randomUUID(),
      userId,
      summary: m.summary,
      sourceMessageId: lastMessageId,
      importance: m.importance,
      createdAt: now,
    }))
  );
}

export async function getOrCreateActiveSession({
  userId,
  now = Date.now(),
  hour = new Date().getHours(),
}: {
  userId: string;
  now?: number;
  hour?: number;
}): Promise<{
  session: SessionContext;
  isNew: boolean;
  msSinceLast: number | null;
}> {
  const [existing] = await db
    .select()
    .from(drifterSessions)
    .where(eq(drifterSessions.userId, userId))
    .orderBy(desc(drifterSessions.startedAt))
    .limit(1);

  const lastEndedAt = existing?.endedAt ?? null;

  if (existing && existing.endedAt === null) {
    return {
      session: {
        sessionId: existing.id,
        dayNumber: existing.dayNumber,
        weather: existing.weather as Weather,
        timeOfDay: existing.timeOfDay as TimeOfDay,
        language: existing.language as "en" | "zh" | "mixed",
      },
      isNew: false,
      msSinceLast: lastEndedAt === null ? null : now - lastEndedAt,
    };
  }

  const dayNumber = (existing?.dayNumber ?? 0) + 1;
  const timeOfDay = pickTimeOfDay(hour);
  const seed = now ^ Number(BigInt(userId.length) << BigInt(8));
  const weather = pickWeather(seed, timeOfDay);

  const id = crypto.randomUUID();
  await db.insert(drifterSessions).values({
    id,
    userId,
    dayNumber,
    weather,
    timeOfDay,
    language: "en",
    startedAt: now,
    endedAt: null,
  });

  return {
    session: {
      sessionId: id,
      dayNumber,
      weather,
      timeOfDay,
      language: "en",
    },
    isNew: true,
    msSinceLast: lastEndedAt === null ? null : now - lastEndedAt,
  };
}

export function detectLanguage(text: string): "en" | "zh" | "mixed" {
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0;
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return "en";
  const ratio = cjk / total;
  if (ratio > 0.5) return "zh";
  if (ratio > 0.1) return "mixed";
  return "en";
}

export function buildOpeningLine({
  isFirstEver,
  msSinceLast,
  language,
}: {
  isFirstEver: boolean;
  msSinceLast: number | null;
  language: "en" | "zh" | "mixed";
}): { text: string; emotion: Emotion } {
  const isZh = language === "zh" || language === "mixed";

  if (isFirstEver) {
    return {
      text: isZh
        ? "...你找到了这里。门从来没锁过，进来吧。"
        : "Oh — you found this place. The door's never locked. Come in.",
      emotion: "gentle",
    };
  }

  if (msSinceLast === null) {
    return {
      text: isZh ? "...你回来了。座位我一直给你留着。" : "...you're back. I kept your seat.",
      emotion: "gentle",
    };
  }

  const hours = msSinceLast / (1000 * 60 * 60);

  if (hours < 6) {
    return {
      text: isZh
        ? "这么快就回来了？是落下什么东西，还是想茶了？"
        : "Back already? Did you forget something, or just missed the tea?",
      emotion: "smile",
    };
  }
  if (hours < 24) {
    return {
      text: isZh ? "回来了。水还温着。" : "Welcome back. The kettle's still warm.",
      emotion: "gentle",
    };
  }
  if (hours < 24 * 3) {
    return {
      text: isZh ? "嘿，旅人。坐。" : "Hey, traveler. Sit.",
      emotion: "smile",
    };
  }
  if (hours < 24 * 7) {
    return {
      text: isZh ? "啊，有几天没见了。" : "Ah. It's been a few days.",
      emotion: "gentle",
    };
  }
  return {
    text: isZh
      ? "...你回来了。座位我一直给你留着。"
      : "...you're back. I kept your seat.",
    emotion: "gentle",
  };
}

export function buildFarewell(language: "en" | "zh" | "mixed"): string {
  return language === "zh" || language === "mixed"
    ? "保重。这条路你想来的时候还在。"
    : "Take care. The path's still here when you need it.";
}

export const TEST_MODE_DRIFTER =
  process.env.DRIFTER_E2E_MOCK === "1" || process.env.DRIFTER_TEST_MODE === "1";

export function fakePipChunk(userMessage: string): PipChunk {
  const isZh = detectLanguage(userMessage) !== "en";
  return {
    emotion: "gentle",
    text: isZh
      ? "（测试模式）我听到了。屋外正下着雨。"
      : "(test mode) I hear you. The rain is outside.",
    hooks: isZh
      ? ["今天累。", "想听你说说自己的事。", "不知道说什么。"]
      : ["Tired today.", "Tell me about your day.", "Don't know what to say."],
  };
}
