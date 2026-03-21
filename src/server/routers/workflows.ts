import { z } from "zod/v4";
import { router, publicProcedure } from "../trpc";
import { db } from "../db";
import { workflows, workflowRuns } from "../db/schema";
import { eq, desc } from "drizzle-orm";

export const workflowsRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(workflows).orderBy(desc(workflows.createdAt));
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const [workflow] = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.id));
      return workflow ?? null;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        nodes: z.string().optional(),
        edges: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      await db.insert(workflows).values({ id, ...input });
      return { id };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        nodes: z.string().optional(),
        edges: z.string().optional(),
        status: z.enum(["draft", "active"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(workflows)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workflows.id, id));
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(workflowRuns).where(eq(workflowRuns.workflowId, input.id));
      await db.delete(workflows).where(eq(workflows.id, input.id));
      return { success: true };
    }),

  // List runs for a workflow
  listRuns: publicProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, input.workflowId))
        .orderBy(desc(workflowRuns.startedAt));
    }),

  // Seed preset workflow templates
  seedPresets: publicProcedure.mutation(async () => {
    const existing = await db.select().from(workflows);
    if (existing.length > 0) return { seeded: false, message: "已有工作流" };

    const presets = [
      {
        name: "URL 内容抓取 + 摘要",
        description: "抓取 URL 内容，自动生成摘要和标签，保存到收藏箱",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "输入 URL", config: {} },
          { id: "2", type: "fetch", label: "抓取内容", config: {} },
          { id: "3", type: "summarize", label: "AI 摘要", config: {} },
          { id: "4", type: "save", label: "保存收藏", config: {} },
        ]),
        edges: JSON.stringify([
          { from: "1", to: "2" },
          { from: "2", to: "3" },
          { from: "3", to: "4" },
        ]),
      },
      {
        name: "每日笔记整理",
        description: "读取今日笔记，生成摘要，提取待办事项",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "定时触发", config: {} },
          { id: "2", type: "query", label: "查询今日笔记", config: {} },
          { id: "3", type: "summarize", label: "AI 整理", config: {} },
          { id: "4", type: "save", label: "生成日报", config: {} },
        ]),
        edges: JSON.stringify([
          { from: "1", to: "2" },
          { from: "2", to: "3" },
          { from: "3", to: "4" },
        ]),
      },
      {
        name: "内容分类归档",
        description: "对未分类的收藏内容自动分类、打标签",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "新收藏触发", config: {} },
          { id: "2", type: "classify", label: "AI 分类", config: {} },
          { id: "3", type: "tag", label: "自动打标签", config: {} },
          { id: "4", type: "save", label: "更新收藏", config: {} },
        ]),
        edges: JSON.stringify([
          { from: "1", to: "2" },
          { from: "2", to: "3" },
          { from: "3", to: "4" },
        ]),
      },
    ];

    for (const preset of presets) {
      const id = crypto.randomUUID();
      await db.insert(workflows).values({ id, ...preset });
    }
    return { seeded: true, count: presets.length };
  }),
});
