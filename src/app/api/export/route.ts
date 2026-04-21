// src/app/api/export/route.ts
//
// GET /api/export?format=json|markdown
//
// Unconditional, unauthenticated-at-the-plan-level data export.
//
// Per billing spec §8.4, every user (Free, Pro, downgraded, cancelled) can
// download a full backup of their own data at any time. This reinforces the
// "you can leave anytime" AGPL-aligned promise and is deliberately NOT gated
// by entitlements.
//
// Format:
//   ?format=json      → one JSON document with every user-scoped table we ship
//   ?format=markdown  → notes only (long-form content that renders well)
//
// Scope: only rows where `userId === session.user.id`. No cross-user joins,
// no server-side rendering — raw rows so users can round-trip into a fresh
// Knosi install (or any other tool) without losing fidelity.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import {
  notes,
  folders,
  bookmarks,
  todos,
  noteImages,
  portfolioHoldings,
  portfolioNews,
  osProjects,
  osProjectNotes,
  analysisPrompts,
  learningTopics,
  learningNotes,
  learningReviews,
  learningPaths,
  activitySessions,
  focusDailySummaries,
} from "@/server/db/schema";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });
  const format = new URL(req.url).searchParams.get("format") ?? "json";

  const userId = session.user.id;

  // Collect user-owned rows from every major module in parallel. Keep the list
  // to tables with a straightforward `userId` column — chat/knowledge/usage
  // are deliberately skipped: they're either ephemeral (chat history, pending
  // jobs) or derived (knowledge chunks regenerate from notes/bookmarks on
  // reindex). Including them would bloat the export without giving the user
  // anything they can round-trip.
  const [
    userFolders,
    userNotes,
    userBookmarks,
    userTodos,
    userNoteImages,
    userPortfolioHoldings,
    userPortfolioNews,
    userOsProjects,
    userOsProjectNotes,
    userAnalysisPrompts,
    userLearningPaths,
    userLearningTopics,
    userLearningNotes,
    userLearningReviews,
    userActivitySessions,
    userFocusDailySummaries,
  ] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, userId)),
    db.select().from(notes).where(eq(notes.userId, userId)),
    db.select().from(bookmarks).where(eq(bookmarks.userId, userId)),
    db.select().from(todos).where(eq(todos.userId, userId)),
    db.select().from(noteImages).where(eq(noteImages.userId, userId)),
    db.select().from(portfolioHoldings).where(eq(portfolioHoldings.userId, userId)),
    db.select().from(portfolioNews).where(eq(portfolioNews.userId, userId)),
    db.select().from(osProjects).where(eq(osProjects.userId, userId)),
    db.select().from(osProjectNotes).where(eq(osProjectNotes.userId, userId)),
    db.select().from(analysisPrompts).where(eq(analysisPrompts.userId, userId)),
    db.select().from(learningPaths).where(eq(learningPaths.userId, userId)),
    db.select().from(learningTopics).where(eq(learningTopics.userId, userId)),
    db.select().from(learningNotes).where(eq(learningNotes.userId, userId)),
    db.select().from(learningReviews).where(eq(learningReviews.userId, userId)),
    db.select().from(activitySessions).where(eq(activitySessions.userId, userId)),
    db.select().from(focusDailySummaries).where(eq(focusDailySummaries.userId, userId)),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    notes: {
      folders: userFolders,
      notes: userNotes,
      bookmarks: userBookmarks,
      todos: userTodos,
      images: userNoteImages,
    },
    portfolio: {
      holdings: userPortfolioHoldings,
      news: userPortfolioNews,
    },
    ossProjects: {
      projects: userOsProjects,
      notes: userOsProjectNotes,
      analysisPrompts: userAnalysisPrompts,
    },
    learning: {
      paths: userLearningPaths,
      topics: userLearningTopics,
      notes: userLearningNotes,
      reviews: userLearningReviews,
    },
    focus: {
      sessions: userActivitySessions,
      dailySummaries: userFocusDailySummaries,
    },
  };

  if (format === "markdown") {
    // Markdown is a convenience format for long-form content only. Everything
    // else (holdings, focus sessions, etc.) is structured data that doesn't
    // render meaningfully as prose — users who want that should grab JSON.
    const renderTitle = (t: unknown) =>
      typeof t === "string" && t.length > 0 ? t : "Untitled";
    const renderBody = (t: unknown) => (typeof t === "string" ? t : "");

    const notesMd = userNotes
      .map((n) => `# ${renderTitle(n.title)}\n\n${renderBody(n.plainText)}\n\n---\n`)
      .join("\n");
    const learningMd = userLearningNotes
      .map((n) => `# ${renderTitle(n.title)}\n\n${renderBody(n.plainText)}\n\n---\n`)
      .join("\n");
    const projectMd = userOsProjectNotes
      .map((n) => `# ${renderTitle(n.title)}\n\n${renderBody(n.plainText)}\n\n---\n`)
      .join("\n");

    const md = [notesMd, learningMd, projectMd].filter(Boolean).join("\n");

    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="knosi-export-${Date.now()}.md"`,
      },
    });
  }

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="knosi-export-${Date.now()}.json"`,
    },
  });
}
