import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { analysisTasks } from "@/server/db/schema";

export async function POST() {
  // Find the oldest queued task
  const [task] = await db
    .select()
    .from(analysisTasks)
    .where(eq(analysisTasks.status, "queued"))
    .orderBy(analysisTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  // Atomically claim it
  await db
    .update(analysisTasks)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(analysisTasks.id, task.id));

  return NextResponse.json({
    task: {
      id: task.id,
      projectId: task.projectId,
      userId: task.userId,
      repoUrl: task.repoUrl,
      taskType: task.taskType,
      question: task.question,
      originalAnalysis: task.originalAnalysis,
    },
  });
}
