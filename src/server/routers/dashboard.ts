import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { notes, bookmarks, todos, osProjectNotes, osProjects, tokenUsageEntries } from "../db/schema";
import { and, asc, count, desc, eq, gte, isNotNull, like, lt, or, sql } from "drizzle-orm";
import { normalizeJournalTitlesForUser } from "../notes/journal-titles";
import { dashboardStatsCache } from "../cache/instances";

/**
 * 真正的 dashboard 统计计算逻辑。
 * 抽成独立函数让 cache 包装层保持简洁。
 */
async function computeDashboardStats(userId: string) {
  await normalizeJournalTitlesForUser(userId);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [noteCount] = await db.select({ count: count() }).from(notes).where(eq(notes.userId, userId));
  const [todoCount] = await db.select({ count: count() }).from(todos).where(eq(todos.userId, userId));
  const [doneCount] = await db
    .select({ count: count() })
    .from(todos)
    .where(and(eq(todos.status, "done"), eq(todos.userId, userId)));

  const recentNotes = await db
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
    .limit(5);

  const pendingTodos = await db
    .select({ id: todos.id, title: todos.title, priority: todos.priority })
    .from(todos)
    .where(and(eq(todos.status, "todo"), eq(todos.userId, userId)))
    .orderBy(desc(todos.createdAt))
    .limit(5);

  const todayTodos = await db
    .select({
      id: todos.id,
      title: todos.title,
      priority: todos.priority,
      status: todos.status,
      dueDate: todos.dueDate,
    })
    .from(todos)
    .where(
      and(
        gte(todos.dueDate, startOfToday),
        lt(todos.dueDate, startOfTomorrow),
        or(eq(todos.status, "todo"), eq(todos.status, "in_progress")),
        eq(todos.userId, userId)
      )
    )
    .orderBy(asc(todos.dueDate), desc(todos.updatedAt))
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

  // Token→Knowledge stats
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [tokenResult] = await db
    .select({ total: sql<number>`coalesce(sum(${tokenUsageEntries.totalTokens}), 0)` })
    .from(tokenUsageEntries)
    .where(
      and(
        eq(tokenUsageEntries.userId, userId),
        gte(tokenUsageEntries.usageAt, startOfMonth)
      )
    );

  const [monthNoteCount] = await db
    .select({ count: count() })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        gte(notes.createdAt, startOfMonth)
      )
    );

  const monthlyTokens = Number(tokenResult?.total ?? 0);
  const notesCreatedThisMonth = monthNoteCount?.count ?? 0;
  const conversionRate =
    monthlyTokens > 0
      ? (notesCreatedThisMonth / (monthlyTokens / 10000)) * 100
      : 0;

  const tokenStats = {
    monthlyTokens,
    notesCreatedThisMonth,
    conversionRate: Math.round(conversionRate * 10) / 10,
  };

  return {
    counts: {
      notes: noteCount.count,
      todos: todoCount.count,
      todosDone: doneCount.count,
    },
    recentNotes,
    recentLearnNotes,
    recentProjectNotes,
    pendingTodos,
    todayTodos,
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
