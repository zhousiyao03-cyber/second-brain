import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { notes, bookmarks, todos, osProjectNotes, osProjects, folders } from "../db/schema";
import { and, count, desc, eq, gte, isNotNull, like, or, sql } from "drizzle-orm";
import { normalizeJournalTitlesForUser } from "../notes/journal-titles";
import { dashboardStatsCache } from "../cache/instances";
import { AI_INBOX_FOLDER_NAME } from "../integrations/ai-inbox";

async function computeDashboardStats(userId: string) {
  await normalizeJournalTitlesForUser(userId);

  const [noteCount] = await db.select({ count: count() }).from(notes).where(eq(notes.userId, userId));

  const recentNotes = await db
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
    .limit(5);

  // Recent folder notes (learning notes now live in notes table with folder set)
  const recentLearnNotes = await db
    .select({
      id: notes.id,
      title: notes.title,
      folder: notes.folder,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), isNotNull(notes.folder)))
    .orderBy(desc(notes.updatedAt))
    .limit(5);

  // Recent project notes (across all projects)
  const recentProjectNotes = await db
    .select({
      id: osProjectNotes.id,
      title: osProjectNotes.title,
      projectId: osProjectNotes.projectId,
      projectName: osProjects.name,
      updatedAt: osProjectNotes.updatedAt,
    })
    .from(osProjectNotes)
    .innerJoin(osProjects, eq(osProjectNotes.projectId, osProjects.id))
    .where(eq(osProjects.userId, userId))
    .orderBy(desc(osProjectNotes.updatedAt))
    .limit(5);

  // AI → Knowledge stats: measure knowledge volume captured via AI (MCP save_to_knosi)
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [inboxFolder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        eq(folders.name, AI_INBOX_FOLDER_NAME),
        sql`${folders.parentId} is null`
      )
    )
    .limit(1);

  let capturedNotes = 0;
  let capturedChars = 0;
  if (inboxFolder) {
    const [row] = await db
      .select({
        count: count(),
        chars: sql<number>`coalesce(sum(length(${notes.plainText})), 0)`,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.folderId, inboxFolder.id),
          gte(notes.createdAt, startOfMonth)
        )
      );
    capturedNotes = row?.count ?? 0;
    capturedChars = Number(row?.chars ?? 0);
  }

  // Rough token estimate: ~4 chars per token (OpenAI/Anthropic English heuristic)
  const capturedTokens = Math.round(capturedChars / 4);
  const daysElapsed = Math.max(
    1,
    Math.ceil((now.getTime() - startOfMonth.getTime()) / 86_400_000)
  );
  const avgPerDay = Math.round((capturedNotes / daysElapsed) * 10) / 10;

  const tokenStats = {
    capturedNotes,
    capturedTokens,
    avgPerDay,
  };

  return {
    counts: {
      notes: noteCount.count,
    },
    recentNotes,
    recentLearnNotes,
    recentProjectNotes,
    tokenStats,
  };
}

export const dashboardRouter = router({
  stats: protectedProcedure.query(async ({ ctx }) => {
    return dashboardStatsCache.getOrLoad(ctx.userId, () => computeDashboardStats(ctx.userId));
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      const q = `%${input.query}%`;

      const noteResults = await db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(and(eq(notes.userId, ctx.userId), or(like(notes.title, q), like(notes.plainText, q))))
        .limit(5);

      const bookmarkResults = await db
        .select({ id: bookmarks.id, title: bookmarks.title, url: bookmarks.url })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, ctx.userId),
            or(
              like(bookmarks.title, q),
              like(bookmarks.url, q),
              like(bookmarks.summary, q),
              like(bookmarks.content, q)
            )
          )
        )
        .limit(5);

      const todoResults = await db
        .select({ id: todos.id, title: todos.title })
        .from(todos)
        .where(and(eq(todos.userId, ctx.userId), like(todos.title, q)))
        .limit(5);

      return {
        notes: noteResults.map((n) => ({ ...n, type: "note" as const })),
        bookmarks: bookmarkResults.map((b) => ({ ...b, type: "bookmark" as const })),
        todos: todoResults.map((t) => ({ ...t, type: "todo" as const })),
      };
    }),
});
