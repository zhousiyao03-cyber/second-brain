import { z } from "zod/v4";
import { generateStructuredData } from "./provider";
import { FOCUS_CATEGORIES, classifySessionFallback } from "../focus/categories.js";

function formatDurationShort(totalSecs: number) {
  const minutes = Math.max(1, Math.round(totalSecs / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function fallbackSessionSummary(session: SessionForClassification) {
  const title = session.windowTitle?.trim();
  if (title) {
    return `${title} in ${session.appName}`;
  }
  return `Worked in ${session.appName} for ${formatDurationShort(session.durationSecs)}`;
}

const sessionClassificationSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      category: z.enum(FOCUS_CATEGORIES),
      summary: z.string(),
    })
  ),
});

type SessionForClassification = {
  id: string;
  appName: string;
  windowTitle: string | null;
  durationSecs: number;
};

type SessionForSummary = {
  appName: string;
  windowTitle: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSecs: number;
  category: string | null;
  aiSummary: string | null;
};

export async function classifyActivitySessions(sessions: SessionForClassification[]) {
  if (sessions.length === 0) {
    return [];
  }

  const sessionList = sessions
    .map(
      (session) =>
        `- id=${session.id} | app=${session.appName} | title=${session.windowTitle ?? "(no title)"} | duration=${Math.max(1, Math.round(session.durationSecs / 60))}min`
    )
    .join("\n");

  try {
    const result = await generateStructuredData({
      name: "focus_session_classification",
      description: "Classify focus tracking sessions and summarize work done in one line.",
      prompt: `Classify each session into exactly one category and generate a short factual summary.

Allowed categories: ${FOCUS_CATEGORIES.join(", ")}.

Sessions:
${sessionList}`,
      schema: sessionClassificationSchema,
    });

    return result.sessions;
  } catch {
    return sessions.map((session) => ({
      id: session.id,
      category: classifySessionFallback(session),
      summary: fallbackSessionSummary(session),
    }));
  }
}

export async function generateDailySummary(input: {
  sessions: SessionForSummary[];
  totalSecs: number;
  categoryBreakdown: Record<string, number>;
  longestStreakSecs: number;
  appSwitches: number;
  date: string;
}) {
  if (input.sessions.length === 0) {
    return null;
  }

  const timeline = input.sessions
    .map((session) => {
      const start = session.startedAt.toISOString();
      const end = session.endedAt.toISOString();
      const category = session.category ?? "other";
      const summary = session.aiSummary ?? session.windowTitle ?? session.appName;
      return `${start} -> ${end} [${category}] ${summary}`;
    })
    .join("\n");

  const breakdown = Object.entries(input.categoryBreakdown)
    .sort(([, left], [, right]) => right - left)
    .map(([category, secs]) => `${category}: ${Math.round(secs / 60)}min`)
    .join(", ");

  try {
    const result = await generateStructuredData({
      name: "focus_daily_summary",
      description: "Generate a concise daily focus summary for a knowledge worker.",
      prompt: `Generate a short factual summary for ${input.date}.

Total focus time: ${(input.totalSecs / 3600).toFixed(1)}h
Longest streak: ${Math.round(input.longestStreakSecs / 60)}min
App switches: ${input.appSwitches}
Category breakdown: ${breakdown}

Timeline:
${timeline}`,
      schema: z.object({ summary: z.string() }),
    });

    return result.summary;
  } catch {
    const topApps = [...new Set(input.sessions.map((session) => session.appName))].slice(0, 3);
    return `Focused for ${formatDurationShort(input.totalSecs)} on ${input.date}, mostly in ${topApps.join(", ")}. Longest streak was ${formatDurationShort(input.longestStreakSecs)} with ${input.appSwitches} app switches.`;
  }
}
