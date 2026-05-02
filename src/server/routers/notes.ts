import { router, protectedProcedure, publicProcedure } from "../trpc";
import { db } from "../db";
import { notes, noteLinks } from "../db/schema";
import { and, count, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { extractWikiLinks } from "../notes/link-extractor";
import { z } from "zod/v4";
import crypto from "crypto";
import {
  enqueueNoteIndexJob,
  removeKnowledgeSourceIndex,
} from "../ai/indexer";
import { assertQuota } from "../billing/quota";
import {
  createJournalTemplate,
  formatJournalTitle,
  formatLegacyJournalTitle,
  extractTomorrowPlanItems,
} from "@/lib/note-templates";
import { normalizeJournalTitlesForUser } from "../notes/journal-titles";
import {
  invalidateDashboardForUser,
  invalidateNotesListForUser,
  notesListCache,
} from "../cache/instances";

const noteCoverSchema = z.string().trim().nullable().optional();
const noteIconSchema = z.string().trim().max(8).nullable().optional();

type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
};

/** Lightweight server-side Tiptap doc → plain text extractor. */
function tiptapDocToPlainText(doc: TiptapNode | null | undefined): string {
  if (!doc) return "";
  const blocks: string[] = [];
  const walk = (node: TiptapNode | undefined, buffer: string[]) => {
    if (!node) return;
    if (typeof node.text === "string") {
      buffer.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, buffer);
    }
  };
  if (Array.isArray(doc.content)) {
    for (const child of doc.content) {
      const buf: string[] = [];
      walk(child, buf);
      const line = buf.join("");
      if (line.trim()) blocks.push(line);
    }
  } else {
    walk(doc, blocks);
  }
  return blocks.join("\n");
}

/** Sync wiki-links from note content to noteLinks table. Fire-and-forget. */
async function syncNoteLinks(noteId: string, content: string | null) {
  const links = extractWikiLinks(content);

  // Delete all existing links from this source
  await db.delete(noteLinks).where(eq(noteLinks.sourceNoteId, noteId));

  // Insert new links
  if (links.length > 0) {
    await db.insert(noteLinks).values(
      links.map((link) => ({
        sourceNoteId: noteId,
        targetNoteId: link.noteId,
        targetTitle: link.noteTitle,
      }))
    ).onConflictDoNothing();
  }
}

export const notesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(30),
          offset: z.number().int().min(0).default(0),
          folderId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 30;
      const offset = input?.offset ?? 0;

      const cacheKey = `${ctx.userId}:${input?.folderId ?? "*"}:${limit}:${offset}`;
      return notesListCache.getOrLoad(
        cacheKey,
        async () => {
          const clauses = [eq(notes.userId, ctx.userId)];
          if (input?.folderId) {
            clauses.push(eq(notes.folderId, input.folderId));
          }

          // Project only fields the list UI actually reads. Skipping `content`
          // (Tiptap JSON, often >50KB per row) cuts the response payload by an
          // order of magnitude on accounts with long notes.
          const items = await db
            .select({
              id: notes.id,
              userId: notes.userId,
              title: notes.title,
              plainText: notes.plainText,
              type: notes.type,
              icon: notes.icon,
              cover: notes.cover,
              folderId: notes.folderId,
              createdAt: notes.createdAt,
              updatedAt: notes.updatedAt,
            })
            .from(notes)
            .where(and(...clauses))
            .orderBy(desc(notes.updatedAt))
            .limit(limit + 1)
            .offset(offset);

          const hasMore = items.length > limit;
          if (hasMore) items.pop();

          return { items, hasMore, offset };
        }
      );
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
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

    await enqueueNoteIndexJob(id, "note-create");

    invalidateDashboardForUser(ctx.userId);
    invalidateNotesListForUser(ctx.userId);
    return { id, created: true };
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string().optional(),
        plainText: z.string().optional(),
        icon: noteIconSchema,
        cover: noteCoverSchema,
        folderId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [{ cnt }] = await db
        .select({ cnt: count() })
        .from(notes)
        .where(eq(notes.userId, ctx.userId));
      assertQuota(ctx.entitlements, "notes", cnt ?? 0, 1);

      const id = crypto.randomUUID();
      await db.insert(notes).values({ id, userId: ctx.userId, ...input });
      await enqueueNoteIndexJob(id, "note-create");
      void syncNoteLinks(id, input.content ?? null).catch(() => undefined);
      invalidateDashboardForUser(ctx.userId);
      invalidateNotesListForUser(ctx.userId);
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        plainText: z.string().optional(),
        icon: noteIconSchema,
        cover: noteCoverSchema,
        folderId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;

      await db
        .update(notes)
        .set({
          ...data,
          updatedAt: new Date(),
          version: sql`${notes.version} + 1`,
        })
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)));

      await enqueueNoteIndexJob(id, "note-update");

      if (input.content !== undefined) {
        const [updatedNote] = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)));
        if (updatedNote) {
          void syncNoteLinks(id, updatedNote.content).catch(() => undefined);
        }
      }

      invalidateDashboardForUser(ctx.userId);
      invalidateNotesListForUser(ctx.userId);
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      void removeKnowledgeSourceIndex("note", input.id).catch(() => undefined);
      invalidateDashboardForUser(ctx.userId);
      invalidateNotesListForUser(ctx.userId);
      return { success: true };
    }),

  backlinks: protectedProcedure
    .input(z.object({ noteId: z.string() }))
    .query(async ({ input, ctx }) => {
      const links = await db
        .select({
          sourceNoteId: noteLinks.sourceNoteId,
          sourceTitle: notes.title,
          sourceIcon: notes.icon,
          updatedAt: notes.updatedAt,
        })
        .from(noteLinks)
        .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
        .where(
          and(
            eq(noteLinks.targetNoteId, input.noteId),
            eq(notes.userId, ctx.userId)
          )
        )
        .orderBy(desc(notes.updatedAt));
      return links;
    }),

  /** Search notes by title (lightweight, for wiki-link autocomplete) */
  searchByTitle: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ input, ctx }) => {
      const q = `%${input.query}%`;
      const results = await db
        .select({
          id: notes.id,
          title: notes.title,
          icon: notes.icon,
        })
        .from(notes)
        .where(
          and(
            eq(notes.userId, ctx.userId),
            sql`lower(${notes.title}) like lower(${q})`
          )
        )
        .orderBy(desc(notes.updatedAt))
        .limit(10);
      return results;
    }),

  enableShare: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db.select({ shareToken: notes.shareToken }).from(notes)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
      if (!note) throw new Error("Note not found");
      // Enabling share on an already-shared note is idempotent and must not
      // consume extra quota — only newly enabling a share counts.
      if (note.shareToken) return { shareToken: note.shareToken };

      const [{ cnt }] = await db
        .select({ cnt: count() })
        .from(notes)
        .where(and(eq(notes.userId, ctx.userId), isNotNull(notes.shareToken)));
      assertQuota(ctx.entitlements, "shareLinks", cnt ?? 0, 1);

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

  /**
   * Append a Tiptap JSONContent[] payload to the end of an existing note's
   * document. Scoped to the current user by `userId`. Used by the inline
   * Ask AI popover's "append to another note" action so the user can park
   * an answer in a different note without leaving their current editor.
   */
  appendBlocks: protectedProcedure
    .input(
      z.object({
        noteId: z.string().min(1),
        blocks: z
          .array(z.any())
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select({ content: notes.content })
        .from(notes)
        .where(
          and(eq(notes.id, input.noteId), eq(notes.userId, ctx.userId))
        )
        .limit(1);

      if (!existing) {
        throw new Error("Note not found");
      }

      let doc: TiptapNode;
      try {
        doc = existing.content
          ? (JSON.parse(existing.content) as TiptapNode)
          : { type: "doc", content: [] };
      } catch {
        doc = { type: "doc", content: [] };
      }
      if (!doc.type) doc.type = "doc";
      const currentContent = Array.isArray(doc.content) ? doc.content : [];
      doc.content = [...currentContent, ...(input.blocks as TiptapNode[])];

      const nextContent = JSON.stringify(doc);
      const nextPlainText = tiptapDocToPlainText(doc);

      await db
        .update(notes)
        .set({
          content: nextContent,
          plainText: nextPlainText,
          updatedAt: new Date(),
          version: sql`${notes.version} + 1`,
        })
        .where(
          and(eq(notes.id, input.noteId), eq(notes.userId, ctx.userId))
        );

      await enqueueNoteIndexJob(input.noteId, "note-append");

      return { ok: true, blocksAppended: input.blocks.length };
    }),
});
