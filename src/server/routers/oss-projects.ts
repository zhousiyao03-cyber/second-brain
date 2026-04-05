import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db";
import { osProjectNotes, osProjects, analysisTasks } from "../db/schema";
import { protectedProcedure, router } from "../trpc";
import { fetchTrending } from "../analysis/trending";
import { fetchRepoInfo } from "../analysis/github";

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

async function collectProjectMeta(projectId: string) {
  const notes = await db
    .select({ tags: osProjectNotes.tags })
    .from(osProjectNotes)
    .where(eq(osProjectNotes.projectId, projectId));

  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of parseTags(note.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    noteCount: notes.length,
    topTags,
  };
}

export const ossProjectsRouter = router({
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const projects = await db
      .select()
      .from(osProjects)
      .where(eq(osProjects.userId, ctx.userId))
      .orderBy(desc(osProjects.updatedAt));

    return Promise.all(
      projects.map(async (project) => ({
        ...project,
        ...(await collectProjectMeta(project.id)),
      }))
    );
  }),

  getProject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [project] = await db
        .select()
        .from(osProjects)
        .where(and(eq(osProjects.id, input.id), eq(osProjects.userId, ctx.userId)));

      if (!project) return null;

      return { ...project, ...(await collectProjectMeta(project.id)) };
    }),

  createProject: protectedProcedure
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

  updateProject: protectedProcedure
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

  deleteProject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(osProjects)
        .where(and(eq(osProjects.id, input.id), eq(osProjects.userId, ctx.userId)));
      return { success: true };
    }),

  listNotes: protectedProcedure
    .input(z.object({ projectId: z.string(), tag: z.string().trim().optional() }))
    .query(async ({ input, ctx }) => {
      const notes = await db
        .select()
        .from(osProjectNotes)
        .where(
          and(
            eq(osProjectNotes.projectId, input.projectId),
            eq(osProjectNotes.userId, ctx.userId)
          )
        )
        .orderBy(desc(osProjectNotes.updatedAt));

      return notes.filter((note) =>
        input.tag ? parseTags(note.tags).includes(input.tag) : true
      );
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

  createNote: protectedProcedure
    .input(noteSchema)
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(osProjectNotes).values({
        id,
        projectId: input.projectId,
        userId: ctx.userId,
        title: input.title?.trim() || "",
        content: input.content,
        plainText: input.plainText,
        tags: input.tags,
      });

      await db
        .update(osProjects)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(osProjects.id, input.projectId),
            eq(osProjects.userId, ctx.userId)
          )
        );

      return { id };
    }),

  updateNote: protectedProcedure
    .input(noteSchema.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId, ...data } = input;
      await db
        .update(osProjectNotes)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(eq(osProjectNotes.id, id), eq(osProjectNotes.userId, ctx.userId))
        );

      await db
        .update(osProjects)
        .set({ updatedAt: new Date() })
        .where(and(eq(osProjects.id, projectId), eq(osProjects.userId, ctx.userId)));

      return { id };
    }),

  deleteNote: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(osProjectNotes)
        .where(
          and(eq(osProjectNotes.id, input.id), eq(osProjectNotes.userId, ctx.userId))
        );

      await db
        .update(osProjects)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(osProjects.id, input.projectId),
            eq(osProjects.userId, ctx.userId)
          )
        );

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

  startAnalysis: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        repoUrl: z.string().trim().url().optional(),
        name: z.string().trim().optional(),
        description: z.string().trim().optional(),
        language: z.string().trim().optional(),
        starsCount: z.number().optional(),
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

      if (!project) return { analysisStatus: null, analysisError: null, activeTaskId: null };

      // Find the active task ID for message polling
      let activeTaskId: string | null = null;
      if (project.analysisStatus === "queued" || project.analysisStatus === "running") {
        const [task] = await db
          .select({ id: analysisTasks.id })
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
      }

      return { ...project, activeTaskId };
    }),

  askFollowup: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        question: z.string().trim().min(1),
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
});
