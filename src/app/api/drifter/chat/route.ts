import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq, asc } from "drizzle-orm";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import {
  drifterMessages,
  drifterSessions,
} from "@/server/db/schema/drifter";
import {
  TEST_MODE_DRIFTER,
  detectLanguage,
  fakePipChunk,
  getPipResponse,
  type PipChunk,
} from "@/server/ai/drifter";
import { getAIErrorMessage } from "@/server/ai/provider";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
});

export async function POST(req: NextRequest) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { sessionId, message } = parsed.data;

  const [sessionRow] = await db
    .select()
    .from(drifterSessions)
    .where(
      and(
        eq(drifterSessions.id, sessionId),
        eq(drifterSessions.userId, userId)
      )
    )
    .limit(1);

  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRow.endedAt) {
    return NextResponse.json(
      { error: "Session already ended" },
      { status: 410 }
    );
  }

  const now = Date.now();
  const userMessageId = crypto.randomUUID();
  await db.insert(drifterMessages).values({
    id: userMessageId,
    sessionId,
    role: "user",
    content: message,
    emotion: null,
    status: "complete",
    hooks: null,
    createdAt: now,
  });

  // Update session language if it has shifted.
  const detected = detectLanguage(message);
  if (detected !== sessionRow.language) {
    await db
      .update(drifterSessions)
      .set({ language: detected })
      .where(eq(drifterSessions.id, sessionId));
  }

  // Load history for context (excludes the user message we just inserted —
  // we pass it separately as userMessage).
  const history = await db
    .select({
      role: drifterMessages.role,
      content: drifterMessages.content,
    })
    .from(drifterMessages)
    .where(
      and(
        eq(drifterMessages.sessionId, sessionId),
        // exclude the user message we just inserted; getPipResponse takes it
        // separately to keep the prompt structure clean
      )
    )
    .orderBy(asc(drifterMessages.createdAt));

  // Drop the just-inserted user message (it is the last row, role=user)
  const historyForPrompt = history.slice(0, -1);

  let chunk: PipChunk;
  try {
    if (TEST_MODE_DRIFTER) {
      chunk = fakePipChunk(message);
    } else {
      chunk = await getPipResponse({
        userId,
        session: {
          sessionId,
          dayNumber: sessionRow.dayNumber,
          weather: sessionRow.weather,
          timeOfDay: sessionRow.timeOfDay,
          language: detected,
        },
        history: historyForPrompt.map((h) => ({
          role: h.role as "user" | "pip",
          content: h.content,
        })),
        userMessage: message,
        signal: req.signal,
      });
    }
  } catch (err) {
    const errMsg = getAIErrorMessage(err, "Pip's lantern flickered.");
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  const pipMessageId = crypto.randomUUID();
  await db.insert(drifterMessages).values({
    id: pipMessageId,
    sessionId,
    role: "pip",
    content: chunk.text,
    emotion: chunk.emotion,
    status: "complete",
    hooks: JSON.stringify(chunk.hooks),
    createdAt: Date.now(),
  });

  return NextResponse.json({
    userMessageId,
    pip: {
      id: pipMessageId,
      emotion: chunk.emotion,
      text: chunk.text,
      hooks: chunk.hooks,
    },
  });
}
