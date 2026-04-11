import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { folders, notes } from "../db/schema";
import { and, eq, sql, asc } from "drizzle-orm";
import { z } from "zod/v4";

export const foldersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const folderRows = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, ctx.userId))
      .orderBy(asc(folders.sortOrder), asc(folders.name));

    // Get note counts per folder
    const countRows = await db
      .select({
        folderId: notes.folderId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(notes)
      .where(eq(notes.userId, ctx.userId))
      .groupBy(notes.folderId);

    const countMap = new Map(
      countRows
        .filter((r) => r.folderId != null)
        .map((r) => [r.folderId!, r.count])
    );

    return folderRows.map((f) => ({
      ...f,
      noteCount: countMap.get(f.id) ?? 0,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        parentId: z.string().nullable().optional(),
        icon: z.string().max(8).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const parentId = input.parentId ?? null;

      // Check for duplicate name among siblings
      const [existing] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.userId, ctx.userId),
            eq(folders.name, input.name),
            parentId
              ? eq(folders.parentId, parentId)
              : sql`${folders.parentId} is null`
          )
        )
        .limit(1);

      if (existing) {
        // Append a number suffix to make it unique
        const name = `${input.name} (2)`;
        input = { ...input, name };
      }

      // Get max sortOrder among siblings
      const [maxSort] = await db
        .select({ max: sql<number>`coalesce(max(${folders.sortOrder}), -1)` })
        .from(folders)
        .where(
          and(
            eq(folders.userId, ctx.userId),
            parentId
              ? eq(folders.parentId, parentId)
              : sql`${folders.parentId} is null`
          )
        );

      const id = crypto.randomUUID();
      await db.insert(folders).values({
        id,
        userId: ctx.userId,
        name: input.name,
        parentId,
        icon: input.icon ?? null,
        sortOrder: (maxSort?.max ?? -1) + 1,
      });

      return { id };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db
        .update(folders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Get the folder to find its parent
      const [folder] = await db
        .select({ parentId: folders.parentId })
        .from(folders)
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));

      if (!folder) return { success: false };

      // Move notes in this folder to parent folder (or root)
      await db
        .update(notes)
        .set({ folderId: folder.parentId, updatedAt: new Date() })
        .where(
          and(eq(notes.folderId, input.id), eq(notes.userId, ctx.userId))
        );

      // Move child folders to parent folder (or root)
      await db
        .update(folders)
        .set({ parentId: folder.parentId, updatedAt: new Date() })
        .where(
          and(eq(folders.parentId, input.id), eq(folders.userId, ctx.userId))
        );

      // Delete the folder itself
      await db
        .delete(folders)
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));

      return { success: true };
    }),

  move: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        targetParentId: z.string().nullable(),
        sortOrder: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Prevent circular nesting: target cannot be self or a descendant
      if (input.targetParentId === input.id) {
        return { success: false, error: "Cannot move folder into itself" };
      }

      if (input.targetParentId) {
        // Walk up the tree from targetParentId to root — if we hit input.id, it's circular
        const allFolders = await db
          .select({ id: folders.id, parentId: folders.parentId })
          .from(folders)
          .where(eq(folders.userId, ctx.userId));

        const parentMap = new Map(allFolders.map((f) => [f.id, f.parentId]));
        let cursor: string | null = input.targetParentId;
        while (cursor) {
          if (cursor === input.id) {
            return { success: false, error: "Cannot move folder into its descendant" };
          }
          cursor = parentMap.get(cursor) ?? null;
        }
      }

      const updates: Record<string, unknown> = {
        parentId: input.targetParentId,
        updatedAt: new Date(),
      };
      if (input.sortOrder !== undefined) {
        updates.sortOrder = input.sortOrder;
      }

      await db
        .update(folders)
        .set(updates)
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));

      return { success: true };
    }),

  toggleCollapse: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [folder] = await db
        .select({ collapsed: folders.collapsed })
        .from(folders)
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));

      if (!folder) return { success: false };

      await db
        .update(folders)
        .set({ collapsed: !folder.collapsed, updatedAt: new Date() })
        .where(and(eq(folders.id, input.id), eq(folders.userId, ctx.userId)));

      return { success: true, collapsed: !folder.collapsed };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            id: z.string(),
            sortOrder: z.number().int().min(0),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      for (const item of input.items) {
        await db
          .update(folders)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(
            and(eq(folders.id, item.id), eq(folders.userId, ctx.userId))
          );
      }
      return { success: true };
    }),
});
