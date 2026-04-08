import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";

export async function POST() {
  const [task] = await db
    .select()
    .from(chatTasks)
    .where(eq(chatTasks.status, "queued"))
    .orderBy(chatTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  const now = new Date();

  // Atomic-ish claim: only transition if still queued
  const updated = await db
    .update(chatTasks)
    .set({ status: "running", startedAt: now })
    .where(and(eq(chatTasks.id, task.id), eq(chatTasks.status, "queued")))
    .returning({ id: chatTasks.id });

  if (updated.length === 0) {
    // Another poll claimed it between the SELECT and UPDATE. Treat as empty.
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
      systemPrompt: task.systemPrompt,
      messages: parsedMessages,
    },
  });
}
