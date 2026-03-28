import { z } from "zod/v4";
import { router, publicProcedure } from "../trpc";
import { db } from "../db";
import { learningPaths, learningLessons } from "../db/schema";
import { eq, asc } from "drizzle-orm";

export const learningRouter = router({
  // List all learning paths
  listPaths: publicProcedure.query(async () => {
    return db.select().from(learningPaths).orderBy(asc(learningPaths.createdAt));
  }),

  // Get a single path with its lessons
  getPath: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const [path] = await db
        .select()
        .from(learningPaths)
        .where(eq(learningPaths.id, input.id));
      if (!path) return null;

      const lessons = await db
        .select()
        .from(learningLessons)
        .where(eq(learningLessons.pathId, input.id))
        .orderBy(asc(learningLessons.orderIndex));

      return { ...path, lessonList: lessons };
    }),

  // Create a learning path
  createPath: publicProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        category: z.enum(["backend", "database", "devops", "ai", "system-design"]),
      })
    )
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      // TODO(task-5): replace with real userId from session
      const userId = "local-dev";
      await db.insert(learningPaths).values({ id, userId, ...input });
      return { id };
    }),

  // Seed preset learning paths
  seedPresets: publicProcedure.mutation(async () => {
    const presets = [
      {
        title: "数据库设计与优化",
        description: "从关系型数据库基础到索引优化、事务、分库分表",
        category: "database" as const,
      },
      {
        title: "API 设计与 Node.js 后端",
        description: "RESTful 与 tRPC、中间件、认证、错误处理",
        category: "backend" as const,
      },
      {
        title: "DevOps 基础",
        description: "Docker、CI/CD、监控、日志、部署策略",
        category: "devops" as const,
      },
      {
        title: "AI Agent 开发",
        description: "LLM API、Prompt Engineering、RAG、Tool Use、Agent 架构",
        category: "ai" as const,
      },
      {
        title: "系统设计",
        description: "架构模式、可扩展性、缓存、消息队列、微服务",
        category: "system-design" as const,
      },
    ];

    const existing = await db.select().from(learningPaths);
    if (existing.length > 0) return { seeded: false, message: "已有学习路径" };

    // TODO(task-5): replace with real userId from session
    const userId = "local-dev";
    for (const preset of presets) {
      const id = crypto.randomUUID();
      await db.insert(learningPaths).values({ id, userId, ...preset });
    }
    return { seeded: true, count: presets.length };
  }),

  // Get a single lesson
  getLesson: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const [lesson] = await db
        .select()
        .from(learningLessons)
        .where(eq(learningLessons.id, input.id));
      return lesson ?? null;
    }),

  // Update lesson status
  completeLesson: publicProcedure
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
  saveLessonNotes: publicProcedure
    .input(z.object({ id: z.string(), notes: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(learningLessons)
        .set({ notes: input.notes })
        .where(eq(learningLessons.id, input.id));
      return { success: true };
    }),
});
