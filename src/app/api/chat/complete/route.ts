import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";
import { publishChatEvent } from "@/server/ai/daemon-chat-events";

export async function POST(request: NextRequest) {
  try {
    await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    taskId: string;
    totalText?: string;
    structuredResult?: string;
    error?: string;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const now = new Date();

  if (body.error) {
    await db
      .update(chatTasks)
      .set({ status: "failed", error: body.error, completedAt: now })
      .where(eq(chatTasks.id, body.taskId));

    await publishChatEvent({
      kind: "error",
      taskId: body.taskId,
      error: body.error,
    });
  } else {
    await db
      .update(chatTasks)
      .set({
        status: "completed",
        totalText: body.totalText ?? "",
        structuredResult: body.structuredResult ?? null,
        completedAt: now,
      })
      .where(eq(chatTasks.id, body.taskId));

    await publishChatEvent({
      kind: "done",
      taskId: body.taskId,
      totalText: body.totalText ?? "",
    });
  }

  return NextResponse.json({ status: "ok" });
}
