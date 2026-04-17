import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { DashboardPageClient } from "@/components/dashboard/dashboard-page-client";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import {
  notes,
  osProjectNotes,
  osProjects,
} from "@/server/db/schema";
import { normalizeJournalTitlesForUser } from "@/server/notes/journal-titles";

export default async function DashboardPage() {
  // Auth is guaranteed by (app) layout guard
  const session = (await getRequestSession())!;
  const userId = session.user!.id!;

  await normalizeJournalTitlesForUser(userId);

  const [noteCount] = await db
    .select({ count: count() })
    .from(notes)
    .where(eq(notes.userId, userId));

  const recentNotes = await db
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
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
    },
    recentNotes,
    recentLearnNotes,
    recentProjectNotes,
    tokenStats: { capturedNotes: 0, capturedTokens: 0, avgPerDay: 0 },
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
