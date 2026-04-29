import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonHeartbeats } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
    userId = auth.userId;
  } catch {
    return NextResponse.json(
      { error: "Invalid or missing access token. Run `knosi login` to authenticate." },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    version?: string;
  };

  const kind = body.kind?.trim() || "chat";
  const version = body.version?.trim() || null;
  const now = new Date();

  const [existing] = await db
    .select({ kind: daemonHeartbeats.kind })
    .from(daemonHeartbeats)
    .where(
      and(eq(daemonHeartbeats.userId, userId), eq(daemonHeartbeats.kind, kind))
    );

  if (!existing) {
    await db
      .insert(daemonHeartbeats)
      .values({ userId, kind, lastSeenAt: now, version });
  } else {
    await db
      .update(daemonHeartbeats)
      .set({ lastSeenAt: now, version })
      .where(
        and(
          eq(daemonHeartbeats.userId, userId),
          eq(daemonHeartbeats.kind, kind)
        )
      );
  }

  return NextResponse.json({ status: "ok" });
}
