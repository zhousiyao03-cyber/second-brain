import { and, asc, count, desc, eq, gte, isNotNull, lt, or } from "drizzle-orm";
import { DashboardPageClient } from "@/components/dashboard/dashboard-page-client";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import {
  notes,
  osProjectNotes,
  osProjects,
  todos,
} from "@/server/db/schema";
import { normalizeJournalTitlesForUser } from "@/server/notes/journal-titles";

export default async function DashboardPage() {
  const session = await getRequestSession();
  const userId = session!.user!.id;

  await normalizeJournalTitlesForUser(userId);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [noteCount] = await db
    .select({ count: count() })
    .from(notes)
    .where(eq(notes.userId, userId));
  const [todoCount] = await db
    .select({ count: count() })
    .from(todos)
    .where(eq(todos.userId, userId));
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

  const initialStats = {
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

  return (
    <DashboardPageClient
      initialStats={initialStats}
      identity={{
        email: session.user?.email,
        name: session.user?.name,
      }}
    />
  );
}
