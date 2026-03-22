import { router, publicProcedure } from "../trpc";
import { db } from "../db";
import { bookmarks } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import crypto from "crypto";
import { fetchContent } from "../ai/fetch-content";

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

      // Insert immediately with pending status
      await db.insert(bookmarks).values({
        id,
        ...input,
        status: input.source === "url" && input.url ? "pending" : "processed",
      });

      // Fetch URL content if source is url
      if (input.source === "url" && input.url) {
        const result = await fetchContent(input.url);

        if (result.success) {
          await db
            .update(bookmarks)
            .set({
              content: result.content,
              title: input.title || result.title || input.url,
              status: "processed",
              updatedAt: new Date(),
            })
            .where(eq(bookmarks.id, id));
        } else {
          await db
            .update(bookmarks)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(bookmarks.id, id));
        }
      }

      return { id };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(bookmarks)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(bookmarks.id, id));
      return { success: true };
    }),

  refetch: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const [bookmark] = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.id, input.id));

      if (!bookmark || !bookmark.url) {
        return { success: false };
      }

      const result = await fetchContent(bookmark.url);

      if (result.success) {
        await db
          .update(bookmarks)
          .set({
            content: result.content,
            title: bookmark.title || result.title || bookmark.url,
            status: "processed",
            updatedAt: new Date(),
          })
          .where(eq(bookmarks.id, input.id));
        return { success: true };
      } else {
        await db
          .update(bookmarks)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(bookmarks.id, input.id));
        return { success: false };
      }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(bookmarks).where(eq(bookmarks.id, input.id));
      return { success: true };
    }),
});
