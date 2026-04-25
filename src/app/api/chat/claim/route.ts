import { NextRequest, NextResponse } from "next/server";
import { eq, and, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;

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

  let taskType: "chat" | "structured" = "chat";
  try {
    const body = await request.json();
    if (body.taskType === "structured") taskType = "structured";
  } catch {
    // empty body = default to chat
  }

  // Reclaim zombies for this task type (scoped to this user)
  const zombieCutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MS);
  await db
    .update(chatTasks)
    .set({ status: "queued", startedAt: null })
    .where(
      and(
        eq(chatTasks.status, "running"),
        eq(chatTasks.taskType, taskType),
        eq(chatTasks.userId, userId),
        lt(chatTasks.startedAt, zombieCutoff)
      )
    );

  // Only claim tasks belonging to the authenticated user
  const [task] = await db
    .select()
    .from(chatTasks)
    .where(
      and(
        eq(chatTasks.status, "queued"),
        eq(chatTasks.taskType, taskType),
        eq(chatTasks.userId, userId)
      )
    )
    .orderBy(chatTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  const now = new Date();
  const updated = await db
    .update(chatTasks)
    .set({ status: "running", startedAt: now })
    .where(and(eq(chatTasks.id, task.id), eq(chatTasks.status, "queued")))
    .returning({ id: chatTasks.id });

  if (updated.length === 0) {
    return NextResponse.json({ task: null });
  }

  let parsedMessages: unknown = [];
  try {
    parsedMessages = JSON.parse(task.messages);
  } catch {
    parsedMessages = [];
  }

  return NextResponse.json({
    task: {
      id: task.id,
      userId: task.userId,
      model: task.model,
      taskType: task.taskType,
      sourceScope: task.sourceScope,
      systemPrompt: task.systemPrompt,
      messages: parsedMessages,
    },
  });
}
