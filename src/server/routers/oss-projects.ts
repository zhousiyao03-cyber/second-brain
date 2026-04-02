import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db";
import { osProjectNotes, osProjects } from "../db/schema";
import { protectedProcedure, router } from "../trpc";

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
});
