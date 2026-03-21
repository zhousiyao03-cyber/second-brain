import { router, publicProcedure } from "../trpc";
import { db } from "../db";
import { bookmarks } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import crypto from "crypto";

export const bookmarksRouter = router({
  list: publicProcedure.query(async () => {
    return db.select().from(bookmarks).orderBy(desc(bookmarks.createdAt));
  }),

  create: publicProcedure
    .input(
      z.object({
        url: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        tags: z.string().optional(),
        source: z.enum(["url", "text", "lark"]).default("url"),
      })
    )
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      await db.insert(bookmarks).values({ id, ...input });
      return { id };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(bookmarks).where(eq(bookmarks.id, input.id));
      return { success: true };
    }),
});
