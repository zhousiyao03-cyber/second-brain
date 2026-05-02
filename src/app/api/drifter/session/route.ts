import { type NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import {
  drifterMessages,
  drifterSessions,
} from "@/server/db/schema/drifter";
import {
  buildOpeningLine,
  getOrCreateActiveSession,
} from "@/server/ai/drifter";

export const runtime = "nodejs";

function detectAcceptLanguage(req: NextRequest): "en" | "zh" | "mixed" {
  const header = req.headers.get("accept-language") ?? "";
  if (/zh/i.test(header)) return "zh";
  return "en";
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = Date.now();
  const hour = new Date().getHours();

  const { session: ctx, isNew, msSinceLast } =
    await getOrCreateActiveSession({ userId, now, hour });

  // For a brand-new session, decide opening language hint from headers.
  // Caller will overwrite later when they detect from real input.
  let language = ctx.language;
  if (isNew && (!language || language === "en")) {
    const detected = detectAcceptLanguage(req);
    if (detected !== "en") {
      language = detected;
      await db
        .update(drifterSessions)
        .set({ language })
        .where(eq(drifterSessions.id, ctx.sessionId));
    }
  }

  // Find whether this user has any prior session at all.
  const [firstEverProbe] = await db
    .select({ id: drifterSessions.id })
    .from(drifterSessions)
    .where(eq(drifterSessions.userId, userId))
    .orderBy(asc(drifterSessions.startedAt))
    .limit(1);

  // First-ever = the only session is the one we just created (or this is a
  // new user). Heuristic: if this session is new AND there is no prior
  // session different from this one.
  const isFirstEver =
    isNew &&
    (firstEverProbe === undefined || firstEverProbe.id === ctx.sessionId);

  // Pull existing history so the client can resume if reloading mid-session.
  const history = await db
    .select()
    .from(drifterMessages)
    .where(eq(drifterMessages.sessionId, ctx.sessionId))
    .orderBy(asc(drifterMessages.createdAt));

  // If brand-new session with no Pip greeting yet, persist one.
  let greeting: { text: string; emotion: string } | null = null;
  if (isNew && history.length === 0) {
    const opening = buildOpeningLine({
      isFirstEver,
      msSinceLast,
      language,
    });
    const greetingId = crypto.randomUUID();
    await db.insert(drifterMessages).values({
      id: greetingId,
      sessionId: ctx.sessionId,
      role: "pip",
      content: opening.text,
      emotion: opening.emotion,
      status: "complete",
      hooks: null,
      createdAt: Date.now(),
    });
    greeting = { text: opening.text, emotion: opening.emotion };
  }

  return NextResponse.json({
    session: {
      id: ctx.sessionId,
      dayNumber: ctx.dayNumber,
      weather: ctx.weather,
      timeOfDay: ctx.timeOfDay,
      language,
    },
    greeting,
    history: history.map((h) => ({
      id: h.id,
      role: h.role,
      content: h.content,
      emotion: h.emotion,
      hooks: h.hooks ? JSON.parse(h.hooks) : null,
      createdAt: h.createdAt,
    })),
  });
}

export async function GET(req: NextRequest) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");

  const rows = await db
    .select({
      id: drifterSessions.id,
      dayNumber: drifterSessions.dayNumber,
      weather: drifterSessions.weather,
      timeOfDay: drifterSessions.timeOfDay,
      startedAt: drifterSessions.startedAt,
      endedAt: drifterSessions.endedAt,
      language: drifterSessions.language,
    })
    .from(drifterSessions)
    .where(eq(drifterSessions.userId, userId))
    .orderBy(drifterSessions.startedAt)
    .limit(Math.min(Math.max(limit, 1), 100));

  return NextResponse.json({ sessions: rows });
}
