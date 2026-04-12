import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  analysisTasks,
  folders,
  notes,
  osProjectNotes,
  osProjects,
} from "@/server/db/schema";
import { markdownToTiptap } from "@/lib/markdown-to-tiptap";
import { verifyCliToken } from "@/server/ai/cli-auth";

const SOURCE_READING_FOLDER_NAME = "源码阅读";

/**
 * Finds or creates the "源码阅读" folder for a given user. All source
 * analysis / followup notes are dropped into this folder so they appear
 * in the unified Notes UI alongside other notes.
 */
async function resolveSourceReadingFolderId(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        eq(folders.name, SOURCE_READING_FOLDER_NAME),
        sql`${folders.parentId} is null`
      )
    )
    .limit(1);

  if (existing) return existing.id;

  const [maxSort] = await db
    .select({ max: sql<number>`coalesce(max(${folders.sortOrder}), -1)` })
    .from(folders)
    .where(
      and(eq(folders.userId, userId), sql`${folders.parentId} is null`)
    );

  const id = crypto.randomUUID();
  await db.insert(folders).values({
    id,
    userId,
    name: SOURCE_READING_FOLDER_NAME,
    parentId: null,
    sortOrder: (maxSort?.max ?? -1) + 1,
  });
  return id;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const cliToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!cliToken || !(await verifyCliToken(cliToken))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    taskId: string;
    result?: string;
    error?: string;
    /** Full git sha that the daemon analysed (set on success). */
    commitSha?: string;
    /** ISO timestamp of that commit (committer date). */
    commitDate?: string;
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

  // Look up project name for tagging
  const [project] = await db
    .select({ name: osProjects.name })
    .from(osProjects)
    .where(eq(osProjects.id, task.projectId))
    .limit(1);
  const projectName = project?.name ?? "";

  const tagList = [
    "源码阅读",
    task.taskType === "analysis" ? "source-analysis" : "followup",
    ...(projectName ? [projectName] : []),
  ];

  // Write to the legacy os_project_notes table (still used by the old
  // /projects/[id] listing for backward compat).
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

  // Also write to the unified notes table so the analysis shows up in
  // the Notes UI under the "源码阅读" folder. This is the new source of
  // truth for reading; the legacy write above is a transitional measure.
  const folderId = await resolveSourceReadingFolderId(task.userId);
  await db.insert(notes).values({
    id: crypto.randomUUID(),
    userId: task.userId,
    title: noteTitle,
    content: JSON.stringify(tiptapDoc),
    plainText: body.result ?? "",
    type: "note",
    tags: JSON.stringify(tagList),
    folderId,
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

  // Update project status — record commit snapshot so the UI can show
  // exactly which version of the repo was analysed.
  const finishedAt = new Date();
  await db
    .update(osProjects)
    .set({
      analysisStatus: "completed",
      analysisError: null,
      analysisCommit: body.commitSha ?? null,
      analysisCommitDate: body.commitDate ? new Date(body.commitDate) : null,
      analysisFinishedAt: finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(osProjects.id, task.projectId));

  return NextResponse.json({ status: "completed" });
}
