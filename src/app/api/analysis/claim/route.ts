import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { analysisPrompts, analysisTasks, osProjects } from "@/server/db/schema";
import {
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_FOLLOWUP_PROMPT,
  renderPrompt,
} from "@/server/ai/default-analysis-prompts";
import { verifyCliToken } from "@/server/ai/cli-auth";

/**
 * The local daemon polls this endpoint to claim queued analysis tasks.
 *
 * Server-side responsibilities:
 *   - Authenticate the daemon via CLI token.
 *   - Atomically transition the oldest queued task (for this user) to "running".
 *   - Stamp `analysisStartedAt` on the project.
 *   - Resolve the user's customized prompt template (or fall back to the bundled
 *     default), substitute repo metadata, and ship the fully-rendered prompt
 *     down to the daemon. The daemon never sees the template — it just runs the
 *     final string. This means prompt edits in Settings take effect on the very
 *     next claim with no daemon restart.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const userId = token ? await verifyCliToken(token) : null;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find the oldest queued task for this user
  const [task] = await db
    .select()
    .from(analysisTasks)
    .where(and(eq(analysisTasks.status, "queued"), eq(analysisTasks.userId, userId)))
    .orderBy(analysisTasks.createdAt)
    .limit(1);

  if (!task) {
    return NextResponse.json({ task: null });
  }

  const now = new Date();

  // Atomically claim it
  await db
    .update(analysisTasks)
    .set({ status: "running", startedAt: now })
    .where(eq(analysisTasks.id, task.id));

  // Sync project status so frontend sees "running"
  await db
    .update(osProjects)
    .set({
      analysisStatus: "running",
      analysisStartedAt: now,
      updatedAt: now,
    })
    .where(eq(osProjects.id, task.projectId));

  // Resolve the user's prompt template (custom override or default)
  const kind = task.taskType === "analysis" ? "analysis" : "followup";
  const [override] = await db
    .select({ content: analysisPrompts.content })
    .from(analysisPrompts)
    .where(
      and(
        eq(analysisPrompts.userId, task.userId),
        eq(analysisPrompts.kind, kind)
      )
    );

  const template =
    override?.content ??
    (kind === "analysis" ? DEFAULT_ANALYSIS_PROMPT : DEFAULT_FOLLOWUP_PROMPT);

  // Render the template with placeholders. The daemon will re-render it
  // *again* after cloning to fill in the commit fields, since those aren't
  // known until git clone completes. We send a half-rendered template here:
  // REPO_URL is filled, commit fields stay as placeholders.
  const rendered = renderPrompt(template, {
    repoUrl: task.repoUrl,
    analysedAt: now.toISOString(),
    question: task.question ?? "",
    originalAnalysis: task.originalAnalysis ?? "",
    // commit fields intentionally omitted — daemon fills these post-clone
    commitSha: undefined,
    commitShort: undefined,
    commitDate: undefined,
  });

  return NextResponse.json({
    task: {
      id: task.id,
      projectId: task.projectId,
      userId: task.userId,
      repoUrl: task.repoUrl,
      taskType: task.taskType,
      provider: task.provider,
      question: task.question,
      originalAnalysis: task.originalAnalysis,
      // Pre-rendered prompt with REPO_URL filled. Commit placeholders remain
      // ({{COMMIT_SHA}}, {{COMMIT_SHORT}}, {{COMMIT_DATE}}) for the daemon to
      // substitute after cloning the repo.
      promptTemplate: rendered,
    },
  });
}
