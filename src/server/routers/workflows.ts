import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { workflows, workflowRuns } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import crypto from "crypto";

export const workflowsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(workflows).where(eq(workflows.userId, ctx.userId)).orderBy(desc(workflows.createdAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [workflow] = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)));
      return workflow ?? null;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        nodes: z.string().optional(),
        edges: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(workflows).values({ id, userId: ctx.userId, ...input });
      return { id };
    }),

  update: protectedProcedure
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
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db
        .update(workflows)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(workflows.id, id), eq(workflows.userId, ctx.userId)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.transaction(async (tx) => {
        await tx.delete(workflowRuns).where(eq(workflowRuns.workflowId, input.id));
        await tx.delete(workflows).where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)));
      });
      return { success: true };
    }),

  // List runs for a workflow
  listRuns: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, input.workflowId))
        .orderBy(desc(workflowRuns.startedAt));
    }),

  // Seed preset workflow templates
  seedPresets: protectedProcedure.mutation(async ({ ctx }) => {
    const existing = await db.select().from(workflows).where(eq(workflows.userId, ctx.userId));
    if (existing.length > 0) return { seeded: false, message: "Workflows already exist" };

    const presets = [
      {
        name: "URL Fetch + Summarize",
        description: "Fetch URL content, auto-generate summary and tags, save to bookmarks",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "Input URL", config: {} },
          { id: "2", type: "fetch", label: "Fetch Content", config: {} },
          { id: "3", type: "summarize", label: "AI Summary", config: {} },
          { id: "4", type: "save", label: "Save Bookmark", config: {} },
        ]),
        edges: JSON.stringify([
          { from: "1", to: "2" },
          { from: "2", to: "3" },
          { from: "3", to: "4" },
        ]),
      },
      {
        name: "Daily Note Digest",
        description: "Read today's notes, generate summary, extract action items",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "Scheduled Trigger", config: {} },
          { id: "2", type: "query", label: "Query Today's Notes", config: {} },
          { id: "3", type: "summarize", label: "AI Digest", config: {} },
          { id: "4", type: "save", label: "Generate Report", config: {} },
        ]),
        edges: JSON.stringify([
          { from: "1", to: "2" },
          { from: "2", to: "3" },
          { from: "3", to: "4" },
        ]),
      },
      {
        name: "Content Categorization",
        description: "Auto-categorize and tag uncategorized bookmarks",
        nodes: JSON.stringify([
          { id: "1", type: "trigger", label: "New Bookmark Trigger", config: {} },
          { id: "2", type: "classify", label: "AI Classify", config: {} },
          { id: "3", type: "tag", label: "Auto Tag", config: {} },
          { id: "4", type: "save", label: "Update Bookmark", config: {} },
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
      await db.insert(workflows).values({ id, userId: ctx.userId, ...preset });
    }
    return { seeded: true, count: presets.length };
  }),
});
