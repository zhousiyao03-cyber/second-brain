import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { analysisTasks, osProjectNotes, osProjects } from "@/server/db/schema";
import { markdownToTiptap } from "@/lib/markdown-to-tiptap";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    result?: string;
    error?: string;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // Fetch the task
  const [task] = await db
    .select()
    .from(analysisTasks)
    .where(eq(analysisTasks.id, body.taskId))
    .limit(1);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (body.error) {
    // Mark task as failed
    await db
      .update(analysisTasks)
      .set({ status: "failed", error: body.error, completedAt: new Date() })
      .where(eq(analysisTasks.id, body.taskId));

    // Update project status
    await db
      .update(osProjects)
      .set({
        analysisStatus: "failed",
        analysisError: body.error,
        updatedAt: new Date(),
      })
      .where(eq(osProjects.id, task.projectId));

    return NextResponse.json({ status: "failed" });
  }

  // Success path — persist note + update statuses
  let noteTitle: string;
  if (task.taskType === "analysis") {
    // Extract title from first "# ..." line in the result, fallback to generic
    const h1Match = (body.result ?? "").match(/^#\s+(.+)$/m);
    noteTitle = h1Match ? h1Match[1].trim() : "源码阅读笔记";
  } else {
    noteTitle = (task.question ?? "Follow-up").slice(0, 100);
  }

  // Strip the first h1 line from content since it's already stored as noteTitle
  const contentMd = (body.result ?? "").replace(/^#\s+.+\n?/, "");
  const tiptapDoc = markdownToTiptap(contentMd);

  await db.insert(osProjectNotes).values({
    id: crypto.randomUUID(),
    projectId: task.projectId,
    userId: task.userId,
    title: noteTitle,
    content: JSON.stringify(tiptapDoc),
    plainText: body.result ?? "",
    tags: JSON.stringify(
      task.taskType === "analysis" ? ["source-analysis"] : ["followup"]
    ),
    noteType: task.taskType === "analysis" ? "analysis" : "followup",
  });

  // Mark task completed
  await db
    .update(analysisTasks)
    .set({
      status: "completed",
      result: body.result,
      completedAt: new Date(),
    })
    .where(eq(analysisTasks.id, body.taskId));

  // Update project status
  await db
    .update(osProjects)
    .set({
      analysisStatus: "completed",
      analysisError: null,
      updatedAt: new Date(),
    })
    .where(eq(osProjects.id, task.projectId));

  return NextResponse.json({ status: "completed" });
}
