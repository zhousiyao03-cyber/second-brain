import { router, publicProcedure } from "../trpc";
import { db } from "../db";
import { todos } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import crypto from "crypto";

export const todosRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(todos).orderBy(desc(todos.createdAt));
  }),

  create: publicProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).default("medium"),
        category: z.string().optional(),
        dueDate: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      await db.insert(todos).values({ id, ...input });
      return { id };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["todo", "in_progress", "done"]).optional(),
        category: z.string().optional(),
        dueDate: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(todos)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(todos.id, id));
      return { id };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(todos).where(eq(todos.id, input.id));
      return { success: true };
    }),
});
