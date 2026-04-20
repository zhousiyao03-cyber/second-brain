import crypto from "crypto";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db";
import {
  analysisPrompts,
  notes as notesTable,
  osProjectNotes,
  osProjects,
  analysisTasks,
} from "../db/schema";
import { proProcedure, protectedProcedure, router } from "../trpc";
import { fetchTrending } from "../analysis/trending";
import { fetchRepoInfo, searchRepos } from "../analysis/github";
import {
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_FOLLOWUP_PROMPT,
} from "../ai/default-analysis-prompts";

const projectSchema = z.object({
  name: z.string().trim().min(1),
  repoUrl: z.string().trim().url().optional().or(z.literal("")),
  description: z.string().trim().optional(),
  language: z.string().trim().optional(),
  aiSummary: z.string().trim().optional(),
});

const noteSchema = z.object({
  projectId: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  plainText: z.string().optional(),
  tags: z.string().optional(),
});

function parseTags(tags: string | null | undefined) {
  if (!tags) return [] as string[];

  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Project notes now live in the unified `notes` table, tagged with the
 * project name. Aggregate note counts + top tags by scanning a user's
 * notes and matching against project names.
 */
async function collectProjectMetaBatch(
  userId: string,
  projects: Array<{ id: string; name: string }>
) {
  const metaMap = new Map<string, { noteCount: number; topTags: string[] }>();
  for (const p of projects) metaMap.set(p.id, { noteCount: 0, topTags: [] });
  if (projects.length === 0) return metaMap;

  const rows = await db
    .select({ tags: notesTable.tags })
    .from(notesTable)
    .where(eq(notesTable.userId, userId));

  const parsed = rows.map((r) => parseTags(r.tags));

  for (const project of projects) {
    const tagCounts = new Map<string, number>();
    let noteCount = 0;
    for (const tagList of parsed) {
      if (tagList.includes(project.name)) {
        noteCount++;
        for (const t of tagList) {
          if (t !== project.name && t !== "Source Reading") {
            tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          }
        }
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);
    metaMap.set(project.id, { noteCount, topTags });
  }

  return metaMap;
}

export const ossProjectsRouter = router({
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const projects = await db
      .select()
      .from(osProjects)
      .where(eq(osProjects.userId, ctx.userId))
      .orderBy(desc(osProjects.updatedAt));

    const metaMap = await collectProjectMetaBatch(ctx.userId, projects);

    return projects.map((project) => ({
      ...project,
      ...(metaMap.get(project.id) ?? { noteCount: 0, topTags: [] }),
    }));
  }),

  listProjectsPaged: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        q: z.string().trim().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { page, pageSize, q } = input;
      const offset = (page - 1) * pageSize;

      const conditions = [eq(osProjects.userId, ctx.userId)];
      if (q) {
        const needle = `%${q.toLowerCase()}%`;
        // Case-insensitive LIKE via lower(col) LIKE lower(needle)
        conditions.push(
          or(
            like(sql`lower(${osProjects.name})`, needle),
            like(sql`lower(${osProjects.description})`, needle),
            like(sql`lower(${osProjects.repoUrl})`, needle)
          )!
        );
      }
      const whereExpr = and(...conditions);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(osProjects)
        .where(whereExpr);

      const rows = await db
        .select()
        .from(osProjects)
        .where(whereExpr)
        .orderBy(desc(osProjects.updatedAt))
        .limit(pageSize)
        .offset(offset);

      const metaMap = await collectProjectMetaBatch(ctx.userId, rows);
      const items = rows.map((project) => ({
        ...project,
        ...(metaMap.get(project.id) ?? { noteCount: 0, topTags: [] }),
      }));

      return {
        items,
        total: Number(count ?? 0),
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(Number(count ?? 0) / pageSize)),
      };
    }),

  firstNoteId: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Look up the project name so we can find the matching unified note.
      const [project] = await db
        .select({ name: osProjects.name })
        .from(osProjects)
        .where(
          and(
            eq(osProjects.id, input.projectId),
            eq(osProjects.userId, ctx.userId)
          )
        );
      if (!project) return null;

      // Find the most recently updated note in the unified notes table
      // that is tagged with the project name. Scan a reasonable batch.
      const candidates = await db
        .select({ id: notesTable.id, tags: notesTable.tags })
        .from(notesTable)
        .where(eq(notesTable.userId, ctx.userId))
        .orderBy(desc(notesTable.updatedAt))
        .limit(200);
      for (const n of candidates) {
        if (parseTags(n.tags).includes(project.name)) return n.id;
      }
      return null;
    }),

  getProject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [project] = await db
        .select()
        .from(osProjects)
        .where(and(eq(osProjects.id, input.id), eq(osProjects.userId, ctx.userId)));

      if (!project) return null;

      const metaMap = await collectProjectMetaBatch(ctx.userId, [project]);
      return {
        ...project,
        ...(metaMap.get(project.id) ?? { noteCount: 0, topTags: [] }),
      };
    }),

  createProject: proProcedure
    .input(projectSchema)
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(osProjects).values({
        id,
        userId: ctx.userId,
        name: input.name,
        repoUrl: input.repoUrl || null,
        description: input.description,
        language: input.language,
        aiSummary: input.aiSummary,
      });
      return { id };
    }),

  updateProject: proProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db
        .update(osProjects)
        .set({
          ...data,
          repoUrl: data.repoUrl || null,
          updatedAt: new Date(),
        })
        .where(and(eq(osProjects.id, id), eq(osProjects.userId, ctx.userId)));
      return { id };
    }),

  deleteProject: proProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(osProjects)
        .where(and(eq(osProjects.id, input.id), eq(osProjects.userId, ctx.userId)));
      return { success: true };
    }),

  enableNoteShare: proProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db
        .select({ shareToken: osProjectNotes.shareToken })
        .from(osProjectNotes)
        .where(and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId)));

      if (!note) {
        throw new Error("Project note not found");
      }

      if (note.shareToken) {
        return { shareToken: note.shareToken };
      }

      const shareToken = crypto.randomUUID();
      await db
        .update(osProjectNotes)
        .set({ shareToken, sharedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId)));

      return { shareToken };
    }),

  disableNoteShare: proProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(osProjectNotes)
        .set({ shareToken: null, sharedAt: null, updatedAt: new Date() })
        .where(and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId)));

      return { success: true };
    }),

  /**
   * List project notes from the unified `notes` table, filtered by the
   * project name tag. Falls back to an empty list if the project is missing.
   * The returned IDs are `notes.id`, so the UI can link directly to
   * /notes/[id].
   */
  listNotes: protectedProcedure
    .input(z.object({ projectId: z.string(), tag: z.string().trim().optional() }))
    .query(async ({ input, ctx }) => {
      const [project] = await db
        .select({ name: osProjects.name })
        .from(osProjects)
        .where(
          and(
            eq(osProjects.id, input.projectId),
            eq(osProjects.userId, ctx.userId)
          )
        );
      if (!project) return [];

      const rows = await db
        .select()
        .from(notesTable)
        .where(eq(notesTable.userId, ctx.userId))
        .orderBy(desc(notesTable.updatedAt));

      return rows
        .filter((note) => {
          const tags = parseTags(note.tags);
          if (!tags.includes(project.name)) return false;
          if (input.tag && !tags.includes(input.tag)) return false;
          return true;
        })
        .map((note) => ({
          ...note,
          // For backward compat with UI that expects noteType on project notes
          noteType: parseTags(note.tags).includes("followup")
            ? "followup"
            : "analysis",
        }));
    }),

  getNote: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [note] = await db
        .select()
        .from(osProjectNotes)
        .where(
          and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId))
        );
      return note ?? null;
    }),

  createNote: proProcedure
    .input(noteSchema)
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(osProjectNotes).values({
          id,
          projectId: input.projectId,
          userId: ctx.userId,
          title: input.title?.trim() || "",
          content: input.content,
          plainText: input.plainText,
          tags: input.tags,
        });

        await tx
          .update(osProjects)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(osProjects.id, input.projectId),
              eq(osProjects.userId, ctx.userId)
            )
          );
      });

      return { id };
    }),

  updateNote: proProcedure
    .input(noteSchema.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId, ...data } = input;
      await db.transaction(async (tx) => {
        await tx
          .update(osProjectNotes)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(eq(osProjectNotes.id, id), eq(osProjectNotes.userId, ctx.userId))
          );

        await tx
          .update(osProjects)
          .set({ updatedAt: new Date() })
          .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, ctx.userId)));
      });

      return { id };
    }),

  deleteNote: proProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(osProjectNotes)
          .where(
            and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId))
          );

        await tx
          .update(osProjects)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(osProjects.id, input.projectId),
              eq(osProjects.userId, ctx.userId)
            )
          );
      });

      return { success: true };
    }),

  trending: protectedProcedure
    .input(
      z.object({
        since: z.enum(["daily", "weekly", "monthly"]).default("daily"),
        language: z.string().trim().optional(),
      })
    )
    .query(async ({ input }) => {
      return fetchTrending(input.since, input.language ?? "");
    }),

  fetchRepoInfo: protectedProcedure
    .input(z.object({ url: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      return fetchRepoInfo(input.url);
    }),

  searchGithub: protectedProcedure
    .input(z.object({ query: z.string().trim().min(1), limit: z.number().int().min(1).max(10).optional() }))
    .query(async ({ input }) => {
      return searchRepos(input.query, input.limit ?? 5);
    }),

  startAnalysis: proProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        repoUrl: z.string().trim().url().optional(),
        name: z.string().trim().optional(),
        description: z.string().trim().optional(),
        language: z.string().trim().optional(),
        starsCount: z.number().optional(),
        provider: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let projectId = input.projectId;

      if (!projectId && input.repoUrl) {
        projectId = crypto.randomUUID();
        await db.insert(osProjects).values({
          id: projectId,
          userId: ctx.userId,
          name: input.name || input.repoUrl,
          repoUrl: input.repoUrl,
          description: input.description,
          language: input.language,
          starsCount: input.starsCount,
          trendingDate: new Date().toISOString().slice(0, 10),
        });
      }

      if (!projectId) {
        throw new Error("Either projectId or repoUrl is required");
      }

      const [project] = await db
        .select()
        .from(osProjects)
        .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, ctx.userId)));

      if (!project?.repoUrl) {
        throw new Error("Project not found or missing repo URL");
      }

      // Enqueue analysis task
      await db.insert(analysisTasks).values({
        projectId,
        userId: ctx.userId,
        taskType: "analysis",
        status: "queued",
        provider: input.provider || "claude",
        repoUrl: project.repoUrl,
      });

      // Update project status for frontend polling
      await db
        .update(osProjects)
        .set({ analysisStatus: "queued", updatedAt: new Date() })
        .where(eq(osProjects.id, projectId));

      return { projectId };
    }),

  analysisStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [project] = await db
        .select({
          analysisStatus: osProjects.analysisStatus,
          analysisError: osProjects.analysisError,
        })
        .from(osProjects)
        .where(and(eq(osProjects.id, input.projectId), eq(osProjects.userId, ctx.userId)));

      if (!project) return { analysisStatus: null, analysisError: null, activeTaskId: null, activeProvider: null };

      // Find the active task ID and provider for message polling
      let activeTaskId: string | null = null;
      let activeProvider: string | null = null;
      if (project.analysisStatus === "queued" || project.analysisStatus === "running") {
        const [task] = await db
          .select({ id: analysisTasks.id, provider: analysisTasks.provider })
          .from(analysisTasks)
          .where(
            and(
              eq(analysisTasks.projectId, input.projectId),
              eq(analysisTasks.status, project.analysisStatus === "queued" ? "queued" : "running")
            )
          )
          .orderBy(analysisTasks.createdAt)
          .limit(1);
        activeTaskId = task?.id ?? null;
        activeProvider = task?.provider ?? null;
      }

      return { ...project, activeTaskId, activeProvider };
    }),

  askFollowup: proProcedure
    .input(
      z.object({
        projectId: z.string(),
        question: z.string().trim().min(1),
        provider: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [project] = await db
        .select()
        .from(osProjects)
        .where(and(eq(osProjects.id, input.projectId), eq(osProjects.userId, ctx.userId)));

      if (!project) throw new Error("Project not found");

      const [analysisNote] = await db
        .select({ plainText: osProjectNotes.plainText })
        .from(osProjectNotes)
        .where(
          and(
            eq(osProjectNotes.projectId, input.projectId),
            eq(osProjectNotes.noteType, "analysis")
          )
        )
        .orderBy(osProjectNotes.createdAt)
        .limit(1);

      // Enqueue followup task
      await db.insert(analysisTasks).values({
        projectId: input.projectId,
        userId: ctx.userId,
        taskType: "followup",
        status: "queued",
        provider: input.provider || "claude",
        repoUrl: project.repoUrl ?? "",
        question: input.question,
        originalAnalysis: analysisNote?.plainText ?? "",
      });

      // Update project status for frontend polling
      await db
        .update(osProjects)
        .set({ analysisStatus: "queued", updatedAt: new Date() })
        .where(eq(osProjects.id, input.projectId));
    }),

  // ── Analysis prompt customization ──────────────────────────────────────
  // Returns the user's customized prompts (if any) plus the bundled defaults,
  // so the Settings UI can show "current vs default" and offer a reset.

  getAnalysisPrompts: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(analysisPrompts)
      .where(eq(analysisPrompts.userId, ctx.userId));

    const byKind = new Map(rows.map((r) => [r.kind, r.content]));

    return {
      analysis: {
        content: byKind.get("analysis") ?? DEFAULT_ANALYSIS_PROMPT,
        isCustom: byKind.has("analysis"),
        default: DEFAULT_ANALYSIS_PROMPT,
      },
      followup: {
        content: byKind.get("followup") ?? DEFAULT_FOLLOWUP_PROMPT,
        isCustom: byKind.has("followup"),
        default: DEFAULT_FOLLOWUP_PROMPT,
      },
    };
  }),

  upsertAnalysisPrompt: proProcedure
    .input(
      z.object({
        kind: z.enum(["analysis", "followup"]),
        content: z.string().trim().min(10),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select({ id: analysisPrompts.id })
        .from(analysisPrompts)
        .where(
          and(
            eq(analysisPrompts.userId, ctx.userId),
            eq(analysisPrompts.kind, input.kind)
          )
        );

      if (existing) {
        await db
          .update(analysisPrompts)
          .set({ content: input.content, updatedAt: new Date() })
          .where(eq(analysisPrompts.id, existing.id));
      } else {
        await db.insert(analysisPrompts).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          kind: input.kind,
          content: input.content,
        });
      }
      return { success: true };
    }),

  resetAnalysisPrompt: proProcedure
    .input(z.object({ kind: z.enum(["analysis", "followup"]) }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(analysisPrompts)
        .where(
          and(
            eq(analysisPrompts.userId, ctx.userId),
            eq(analysisPrompts.kind, input.kind)
          )
        );
      return { success: true };
    }),
});
