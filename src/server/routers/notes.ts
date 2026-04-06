import { router, protectedProcedure, publicProcedure } from "../trpc";
import { db } from "../db";
import { notes } from "../db/schema";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { z } from "zod/v4";
import crypto from "crypto";
import {
  removeKnowledgeSourceIndex,
  syncNoteKnowledgeIndex,
} from "../ai/indexer";
import {
  createJournalTemplate,
  formatJournalTitle,
  formatLegacyJournalTitle,
  extractTomorrowPlanItems,
} from "@/lib/note-templates";
import { normalizeJournalTitlesForUser } from "../notes/journal-titles";

const noteCoverSchema = z.string().trim().nullable().optional();
const noteIconSchema = z.string().trim().max(8).nullable().optional();

export const notesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await normalizeJournalTitlesForUser(ctx.userId);
    return db.select().from(notes).where(eq(notes.userId, ctx.userId)).orderBy(desc(notes.updatedAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await normalizeJournalTitlesForUser(ctx.userId);
      const result = await db.select().from(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      return result[0] ?? null;
    }),

  openTodayJournal: protectedProcedure.mutation(async ({ ctx }) => {
    await normalizeJournalTitlesForUser(ctx.userId);
    const todayTitle = formatJournalTitle();
    const legacyTodayTitle = formatLegacyJournalTitle();
    const [existingTodayJournal] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.userId, ctx.userId),
          eq(notes.type, "journal"),
          or(eq(notes.title, todayTitle), eq(notes.title, legacyTodayTitle))
        )
      )
      .orderBy(desc(notes.updatedAt))
      .limit(1);

    if (existingTodayJournal) {
      return { id: existingTodayJournal.id, created: false };
    }

    const [latestPreviousJournal] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.userId, ctx.userId),
          eq(notes.type, "journal"),
          ne(notes.title, todayTitle)
        )
      )
      .orderBy(desc(notes.updatedAt))
      .limit(1);

    const carryOverItems = extractTomorrowPlanItems(
      latestPreviousJournal?.content ?? null
    );
    const journalInput = createJournalTemplate(new Date(), carryOverItems);
    const id = crypto.randomUUID();

    await db.insert(notes).values({ id, userId: ctx.userId, ...journalInput });

    const [createdNote] = await db.select().from(notes).where(eq(notes.id, id));
    if (createdNote) {
      void syncNoteKnowledgeIndex(createdNote, "note-create").catch(
        () => undefined
      );
    }

    return { id, created: true };
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string().optional(),
        plainText: z.string().optional(),
        type: z.enum(["note", "journal", "summary"]).default("note"),
        icon: noteIconSchema,
        cover: noteCoverSchema,
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(notes).values({ id, userId: ctx.userId, ...input });
      const [createdNote] = await db.select().from(notes).where(eq(notes.id, id));
      if (createdNote) {
        void syncNoteKnowledgeIndex(createdNote, "note-create").catch(
          () => undefined
        );
      }
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        plainText: z.string().optional(),
        type: z.enum(["note", "journal", "summary"]).optional(),
        icon: noteIconSchema,
        cover: noteCoverSchema,
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db
        .update(notes)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)));

      const [updatedNote] = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)));
      if (updatedNote) {
        void syncNoteKnowledgeIndex(updatedNote, "note-update").catch(
          () => undefined
        );
      }

      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      void removeKnowledgeSourceIndex("note", input.id).catch(() => undefined);
      return { success: true };
    }),

  enableShare: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db.select({ shareToken: notes.shareToken }).from(notes)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      if (!note) throw new Error("Note not found");
      if (note.shareToken) return { shareToken: note.shareToken };

      const shareToken = crypto.randomUUID();
      await db.update(notes)
        .set({ shareToken, sharedAt: new Date() })
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      return { shareToken };
    }),

  disableShare: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.update(notes)
        .set({ shareToken: null, sharedAt: null })
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      return { success: true };
    }),

  getShared: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const [note] = await db
        .select({
          title: notes.title,
          content: notes.content,
          cover: notes.cover,
          icon: notes.icon,
          tags: notes.tags,
          type: notes.type,
          sharedAt: notes.sharedAt,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(eq(notes.shareToken, input.token));
      return note ?? null;
    }),
});
