import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import { drifterSessions } from "@/server/db/schema/drifter";
import { extractMemories, TEST_MODE_DRIFTER } from "@/server/ai/drifter";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.string().min(1),
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
  const { sessionId } = parsed.data;

  const result = await db
    .update(drifterSessions)
    .set({ endedAt: Date.now() })
    .where(
      and(
        eq(drifterSessions.id, sessionId),
        eq(drifterSessions.userId, userId)
      )
    )
    .returning();

  if (result.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Trigger memory extraction in the background. We do not await — the
  // visitor has already left. Errors are swallowed inside extractMemories.
  if (!TEST_MODE_DRIFTER) {
    extractMemories({ sessionId, userId }).catch(() => {
      // best-effort
    });
  }

  return NextResponse.json({ ok: true });
}
