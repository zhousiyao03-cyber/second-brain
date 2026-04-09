import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threshold = new Date(Date.now() - STALE_RUNNING_MS);

  const stale = await db
    .select({ id: chatTasks.id })
    .from(chatTasks)
    .where(and(eq(chatTasks.status, "running"), lt(chatTasks.startedAt, threshold)));

  for (const row of stale) {
    await db
      .update(chatTasks)
      .set({
        status: "failed",
        error: "Task stalled (daemon crash or lost connection)",
        completedAt: new Date(),
      })
      .where(eq(chatTasks.id, row.id));
  }

  return NextResponse.json({ cleaned: stale.length });
}
