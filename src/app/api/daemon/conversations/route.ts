import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { daemonConversations } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";

const upsertSchema = z.object({
  workerKey: z.string().min(1).max(256),
  cliSessionId: z.string().min(1).max(256).nullable(),
});

async function authUser(request: NextRequest): Promise<string | null> {
  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
    return auth.userId;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const userId = await authUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workerKey = request.nextUrl.searchParams.get("workerKey");
  if (!workerKey) {
    return NextResponse.json(
      { error: "workerKey required" },
      { status: 400 }
    );
  }
  const [row] = await db
    .select({ cliSessionId: daemonConversations.cliSessionId })
    .from(daemonConversations)
    .where(
      and(
        eq(daemonConversations.userId, userId),
        eq(daemonConversations.workerKey, workerKey)
      )
    )
    .limit(1);
  return NextResponse.json({ cliSessionId: row?.cliSessionId ?? null });
}

export async function POST(request: NextRequest) {
  const userId = await authUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { workerKey, cliSessionId } = parsed.data;
  const now = new Date();

  const [existing] = await db
    .select({ id: daemonConversations.id })
    .from(daemonConversations)
    .where(
      and(
        eq(daemonConversations.userId, userId),
        eq(daemonConversations.workerKey, workerKey)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(daemonConversations)
      .set({ cliSessionId, lastUsedAt: now })
      .where(eq(daemonConversations.id, existing.id));
  } else {
    await db.insert(daemonConversations).values({
      userId,
      workerKey,
      cliSessionId,
      lastUsedAt: now,
      createdAt: now,
    });
  }
  return NextResponse.json({ ok: true });
}
