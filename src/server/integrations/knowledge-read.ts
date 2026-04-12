import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "../db";
import { bookmarks, notes } from "../db/schema";

export type KnowledgeItemType = "note" | "bookmark";

export type KnowledgeSearchResult = {
  id: string;
  type: KnowledgeItemType;
  title: string;
  snippet: string;
  updatedAt: Date | null;
};

function clampLimit(limit: number | undefined, max = 20) {
  return Math.min(Math.max(limit ?? 10, 1), max);
}

function snippetFromText(value: string | null | undefined, max = 180) {
  const text = value?.trim() ?? "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function searchKnowledge(input: {
  userId: string;
  query: string;
  limit?: number;
}) {
  const q = input.query.trim();
  if (!q) {
    return [];
  }

  const limit = clampLimit(input.limit);
  const likeQuery = `%${q}%`;

  const [noteRows, bookmarkRows] = await Promise.all([
    db
      .select({
        id: notes.id,
        title: notes.title,
        plainText: notes.plainText,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, input.userId),
          or(like(notes.title, likeQuery), like(notes.plainText, likeQuery))
        )
      )
      .orderBy(desc(notes.updatedAt))
      .limit(limit),
    db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        content: bookmarks.content,
        updatedAt: bookmarks.updatedAt,
      })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, input.userId),
          or(
            like(bookmarks.title, likeQuery),
            like(bookmarks.content, likeQuery),
            like(bookmarks.summary, likeQuery)
          )
        )
      )
      .orderBy(desc(bookmarks.updatedAt))
      .limit(limit),
  ]);

  return [
    ...noteRows.map(
      (row): KnowledgeSearchResult => ({
        id: row.id,
        type: "note",
        title: row.title,
        snippet: snippetFromText(row.plainText),
        updatedAt: row.updatedAt,
      })
    ),
    ...bookmarkRows.map(
      (row): KnowledgeSearchResult => ({
        id: row.id,
        type: "bookmark",
        title: row.title ?? row.id,
        snippet: snippetFromText(row.content),
        updatedAt: row.updatedAt,
      })
    ),
  ]
    .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0))
    .slice(0, limit);
}

export async function listRecentKnowledge(input: {
  userId: string;
  limit?: number;
}) {
  const limit = clampLimit(input.limit);

  const [noteRows, bookmarkRows] = await Promise.all([
    db
      .select({
        id: notes.id,
        title: notes.title,
        plainText: notes.plainText,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(eq(notes.userId, input.userId))
      .orderBy(desc(notes.updatedAt))
      .limit(limit),
    db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        content: bookmarks.content,
        updatedAt: bookmarks.updatedAt,
      })
      .from(bookmarks)
      .where(eq(bookmarks.userId, input.userId))
      .orderBy(desc(bookmarks.updatedAt))
      .limit(limit),
  ]);

  return [
    ...noteRows.map(
      (row): KnowledgeSearchResult => ({
        id: row.id,
        type: "note",
        title: row.title,
        snippet: snippetFromText(row.plainText),
        updatedAt: row.updatedAt,
      })
    ),
    ...bookmarkRows.map(
      (row): KnowledgeSearchResult => ({
        id: row.id,
        type: "bookmark",
        title: row.title ?? row.id,
        snippet: snippetFromText(row.content),
        updatedAt: row.updatedAt,
      })
    ),
  ]
    .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0))
    .slice(0, limit);
}

export async function getKnowledgeItem(input: {
  userId: string;
  id: string;
  type?: KnowledgeItemType;
}) {
  if (input.type !== "bookmark") {
    const [note] = await db
      .select({
        id: notes.id,
        type: notes.type,
        title: notes.title,
        content: notes.content,
        plainText: notes.plainText,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(eq(notes.userId, input.userId), eq(notes.id, input.id)))
      .limit(1);

    if (note) {
      return {
        id: note.id,
        type: "note" as const,
        title: note.title,
        content: note.content,
        plainText: note.plainText,
        updatedAt: note.updatedAt,
      };
    }
  }

  if (input.type !== "note") {
    const [bookmark] = await db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        content: bookmarks.content,
        summary: bookmarks.summary,
        updatedAt: bookmarks.updatedAt,
      })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, input.userId), eq(bookmarks.id, input.id)))
      .limit(1);

    if (bookmark) {
      return {
        id: bookmark.id,
        type: "bookmark" as const,
        title: bookmark.title ?? bookmark.id,
        content: bookmark.content,
        plainText: bookmark.summary ?? bookmark.content ?? null,
        updatedAt: bookmark.updatedAt,
      };
    }
  }

  return null;
}
