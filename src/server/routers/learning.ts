import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { learningPaths, learningLessons } from "../db/schema";
import { and, eq, asc } from "drizzle-orm";
import crypto from "crypto";

export const learningRouter = router({
  // List all learning paths
  listPaths: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(learningPaths).where(eq(learningPaths.userId, ctx.userId)).orderBy(asc(learningPaths.createdAt));
  }),

  // Get a single path with its lessons
  getPath: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [path] = await db
        .select()
        .from(learningPaths)
        .where(and(eq(learningPaths.id, input.id), eq(learningPaths.userId, ctx.userId)));
      if (!path) return null;

      const lessons = await db
        .select()
        .from(learningLessons)
        .where(eq(learningLessons.pathId, input.id))
        .orderBy(asc(learningLessons.orderIndex));

      return { ...path, lessonList: lessons };
    }),

  // Create a learning path
  createPath: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        category: z.enum(["backend", "database", "devops", "ai", "system-design"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(learningPaths).values({ id, userId: ctx.userId, ...input });
      return { id };
    }),

  // Seed preset learning paths
  seedPresets: protectedProcedure.mutation(async ({ ctx }) => {
    const presets = [
      {
        title: "Database Design & Optimization",
        description: "From relational database fundamentals to index optimization, transactions, and sharding",
        category: "database" as const,
      },
      {
        title: "API Design & Node.js Backend",
        description: "RESTful & tRPC, middleware, authentication, error handling",
        category: "backend" as const,
      },
      {
        title: "DevOps Fundamentals",
        description: "Docker, CI/CD, monitoring, logging, deployment strategies",
        category: "devops" as const,
      },
      {
        title: "AI Agent Development",
        description: "LLM API, Prompt Engineering, RAG, Tool Use, Agent architecture",
        category: "ai" as const,
      },
      {
        title: "System Design",
        description: "Architecture patterns, scalability, caching, message queues, microservices",
        category: "system-design" as const,
      },
    ];

    const existing = await db.select().from(learningPaths).where(eq(learningPaths.userId, ctx.userId));
    if (existing.length > 0) return { seeded: false, message: "Learning paths already exist" };

    for (const preset of presets) {
      const id = crypto.randomUUID();
      await db.insert(learningPaths).values({ id, userId: ctx.userId, ...preset });
    }
    return { seeded: true, count: presets.length };
  }),

  // Get a single lesson
  getLesson: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const [lesson] = await db
        .select()
        .from(learningLessons)
        .where(eq(learningLessons.id, input.id));
      return lesson ?? null;
    }),

  // Update lesson status
  completeLesson: protectedProcedure
    .input(z.object({ id: z.string(), pathId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(learningLessons)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(learningLessons.id, input.id));

      // Update path progress
      const allLessons = await db
        .select()
        .from(learningLessons)
        .where(eq(learningLessons.pathId, input.pathId));

      if (allLessons.length > 0) {
        const completed = allLessons.filter(
          (l) => l.status === "completed" || l.id === input.id
        ).length;
        const progress = Math.round((completed / allLessons.length) * 100);
        await db
          .update(learningPaths)
          .set({ progress, updatedAt: new Date() })
          .where(eq(learningPaths.id, input.pathId));
      }

      return { success: true };
    }),

  // Save lesson notes
  saveLessonNotes: protectedProcedure
    .input(z.object({ id: z.string(), notes: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(learningLessons)
        .set({ notes: input.notes })
        .where(eq(learningLessons.id, input.id));
      return { success: true };
    }),
});
