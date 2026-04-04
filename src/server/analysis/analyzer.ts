/**
 * Claude CLI analyzer service for open source project source-code analysis.
 *
 * Manages concurrent analysis jobs (max 3), clones repos into a shared temp
 * directory, spawns the `claude` CLI, persists results as osProjectNotes, and
 * processes a pending queue after each job completes.
 */

import { spawn, execSync } from "child_process";
import { existsSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { osProjects, osProjectNotes } from "../db/schema";
import { buildAnalysisPrompt, buildFollowupPrompt } from "./prompt";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of analysis jobs that may run concurrently. */
const MAX_CONCURRENT = 3;

/** Root directory under which repo clones are cached. */
const BASE_DIR = join(tmpdir(), "source-readings");

/** How long (ms) a cached clone is considered fresh before cleanup. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── In-process concurrency counter ───────────────────────────────────────────

/** Tracks the number of currently running analysis jobs in this process. */
let runningCount = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initiates source-code analysis for a project.
 *
 * - If fewer than MAX_CONCURRENT jobs are running, fires off `runAnalysis()`
 *   in the background and returns `{ status: "analyzing" }`.
 * - Otherwise sets the project's analysisStatus to "pending" in the DB and
 *   returns `{ status: "pending" }`.
 */
export async function startAnalysis(
  projectId: string,
  repoUrl: string,
  userId: string
): Promise<{ status: "analyzing" | "pending" }> {
  if (runningCount < MAX_CONCURRENT) {
    // Set status BEFORE firing off the background job so the frontend sees it immediately.
    await db
      .update(osProjects)
      .set({ analysisStatus: "analyzing", updatedAt: new Date() })
      .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, userId)));

    // Fire-and-forget — do not await so the caller gets an immediate response.
    runAnalysis(projectId, repoUrl, userId).catch((err) => {
      console.error(`[analyzer] runAnalysis failed for ${projectId}:`, err);
    });
    return { status: "analyzing" };
  }

  // At capacity — queue the job.
  await db
    .update(osProjects)
    .set({ analysisStatus: "pending", updatedAt: new Date() })
    .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, userId)));

  return { status: "pending" };
}

/**
 * Handles a follow-up question on a previously analysed project.
 *
 * Clones the repo if not already cached, spawns Claude with the follow-up
 * prompt, then persists the answer as an osProjectNote with noteType "followup".
 */
export async function runFollowup(
  projectId: string,
  userId: string,
  question: string,
  originalAnalysis: string,
  repoUrl: string
): Promise<void> {
  const repoDir = await cloneRepo(repoUrl, repoSlug(repoUrl));

  const prompt = buildFollowupPrompt(originalAnalysis, question);
  const answer = await spawnClaude(prompt, repoDir);

  await db.insert(osProjectNotes).values({
    id: crypto.randomUUID(),
    projectId,
    userId,
    title: question.slice(0, 100),
    content: answer,
    plainText: answer,
    tags: JSON.stringify(["followup"]),
    noteType: "followup",
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Full analysis pipeline for a single project:
 *   1. Set analysisStatus → "analyzing"
 *   2. Clone repo (or reuse cache)
 *   3. Spawn Claude CLI with the analysis prompt
 *   4. Persist note with noteType "analysis"
 *   5. Set analysisStatus → "completed"
 *
 * On any failure, sets analysisStatus → "failed" with the error message.
 * Always decrements the running counter and triggers pending-queue processing.
 */
async function runAnalysis(
  projectId: string,
  repoUrl: string,
  userId: string
): Promise<void> {
  runningCount++;

  try {
    // analysisStatus is already set to "analyzing" by startAnalysis() before
    // this function is called, so no need to set it again here.

    // Clean up expired clones before potentially cloning a new one.
    cleanupExpired();

    const repoDir = await cloneRepo(repoUrl, repoSlug(repoUrl));

    const prompt = buildAnalysisPrompt(repoUrl);
    const result = await spawnClaude(prompt, repoDir);

    // Persist the analysis note.
    await db.insert(osProjectNotes).values({
      id: crypto.randomUUID(),
      projectId,
      userId,
      title: "源码阅读笔记",
      content: result,
      plainText: result,
      tags: JSON.stringify(["source-analysis"]),
      noteType: "analysis",
    });

    // Mark as completed.
    await db
      .update(osProjects)
      .set({
        analysisStatus: "completed",
        analysisError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, userId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(osProjects)
      .set({
        analysisStatus: "failed",
        analysisError: message,
        updatedAt: new Date(),
      })
      .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, userId)));
  } finally {
    runningCount--;
    // Pick up the next queued job, if any.
    processPendingQueue().catch((err) => {
      console.error("[analyzer] processPendingQueue error:", err);
    });
  }
}

/**
 * Spawns the `claude` CLI with the given prompt inside `cwd`.
 *
 * Uses `child_process.spawn` with `detached: true` so that the child process
 * can survive potential parent termination. Returns the full stdout string.
 */
function spawnClaude(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Bash", "--output-format", "text"],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(
          new Error(
            `claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`
          )
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks).toString("utf8"));
    });
  });
}

/**
 * Clones `repoUrl` with `--depth=1` into `BASE_DIR/<slug>`.
 * If the target directory already exists the clone is skipped (cache hit).
 * Returns the absolute path to the cloned directory.
 */
async function cloneRepo(repoUrl: string, slug: string): Promise<string> {
  const dest = join(BASE_DIR, slug);

  if (!existsSync(dest)) {
    // Ensure parent directory exists.
    execSync(`mkdir -p "${BASE_DIR}"`);
    execSync(`git clone --depth=1 "${repoUrl}" "${dest}"`, {
      timeout: 120_000,
      stdio: "pipe",
    });
  }

  return dest;
}

/**
 * Removes cached clone directories older than CACHE_TTL_MS from BASE_DIR.
 * Errors are swallowed — cleanup is best-effort.
 */
function cleanupExpired(): void {
  if (!existsSync(BASE_DIR)) return;

  try {
    const entries = readdirSync(BASE_DIR);
    const now = Date.now();

    for (const entry of entries) {
      const entryPath = join(BASE_DIR, entry);
      try {
        const stat = statSync(entryPath);
        const ageMs = now - stat.mtimeMs;
        if (ageMs > CACHE_TTL_MS) {
          rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore per-entry errors.
      }
    }
  } catch {
    // Ignore directory-level errors.
  }
}

/**
 * Picks up at most one "pending" project and starts analysing it.
 * Called after each analysis job completes to drain the queue.
 */
async function processPendingQueue(): Promise<void> {
  if (runningCount >= MAX_CONCURRENT) return;

  // Find the oldest pending project (any user).
  const [pending] = await db
    .select({
      id: osProjects.id,
      userId: osProjects.userId,
      repoUrl: osProjects.repoUrl,
    })
    .from(osProjects)
    .where(eq(osProjects.analysisStatus, "pending"))
    .limit(1);

  if (!pending || !pending.repoUrl) return;

  // Fire off analysis for the pending project.
  runAnalysis(pending.id, pending.repoUrl, pending.userId).catch((err) => {
    console.error(`[analyzer] runAnalysis (queued) failed for ${pending.id}:`, err);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Derives a filesystem-safe slug from a repo URL.
 * e.g. "https://github.com/owner/repo" → "owner__repo"
 */
function repoSlug(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    // Use pathname segments joined by double-underscores to avoid path issues.
    return url.pathname
      .replace(/^\//, "")
      .replace(/\//g, "__")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
  } catch {
    // Fallback: sanitise arbitrary strings.
    return repoUrl.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  }
}
