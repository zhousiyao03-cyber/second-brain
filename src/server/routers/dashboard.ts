import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { notes, bookmarks, todos, learningNotes, learningTopics, osProjectNotes, osProjects } from "../db/schema";
import { and, asc, count, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { normalizeJournalTitlesForUser } from "../notes/journal-titles";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async ({ ctx }) => {
    await normalizeJournalTitlesForUser(ctx.userId);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [noteCount] = await db.select({ count: count() }).from(notes).where(eq(notes.userId, ctx.userId));
    const [todoCount] = await db.select({ count: count() }).from(todos).where(eq(todos.userId, ctx.userId));
    const [doneCount] = await db
      .select({ count: count() })
      .from(todos)
      .where(and(eq(todos.status, "done"), eq(todos.userId, ctx.userId)));

    const recentNotes = await db
      .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.userId, ctx.userId))
      .orderBy(desc(notes.updatedAt))
      .limit(5);

    const pendingTodos = await db
      .select({ id: todos.id, title: todos.title, priority: todos.priority })
      .from(todos)
      .where(and(eq(todos.status, "todo"), eq(todos.userId, ctx.userId)))
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
          eq(todos.userId, ctx.userId)
        )
      )
      .orderBy(asc(todos.dueDate), desc(todos.updatedAt))
      .limit(5);

    // Recent learning notes (across all topics)
    const recentLearnNotes = await db
      .select({
        id: learningNotes.id,
        title: learningNotes.title,
        topicId: learningNotes.topicId,
        topicTitle: learningTopics.title,
        topicIcon: learningTopics.icon,
        updatedAt: learningNotes.updatedAt,
      })
      .from(learningNotes)
      .innerJoin(learningTopics, eq(learningNotes.topicId, learningTopics.id))
      .where(eq(learningTopics.userId, ctx.userId))
      .orderBy(desc(learningNotes.updatedAt))
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
      .where(eq(osProjects.userId, ctx.userId))
      .orderBy(desc(osProjectNotes.updatedAt))
      .limit(5);

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
    };
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
