import { z } from "zod/v4";
import { generateStructuredData } from "./provider";

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

const sessionSummarySchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
    })
  ),
});

type SessionForClassification = {
  id: string;
  appName: string;
  windowTitle: string | null;
  browserUrl: string | null;
  tags: string | null;
  durationSecs: number;
};

type SessionForSummary = {
  appName: string;
  windowTitle: string | null;
  browserUrl: string | null;
  tags: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSecs: number;
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
      description: "Summarize focus tracking sessions in one short factual line each.",
      prompt: `Generate one short factual summary per session.

Sessions:
${sessionList}`,
      schema: sessionSummarySchema,
    });

    return result.sessions;
  } catch {
    return sessions.map((session) => ({
      id: session.id,
      summary: fallbackSessionSummary(session),
    }));
  }
}

export async function generateDailySummary(input: {
  sessions: SessionForSummary[];
  totalSecs: number;
  tagBreakdown: Record<string, number>;
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
      const tags = parseTags(session.tags).join(", ") || "untagged";
      const summary = session.aiSummary ?? session.windowTitle ?? session.appName;
      const location = session.browserUrl ? ` (${session.browserUrl})` : "";
      return `${start} -> ${end} [${tags}] ${summary}${location}`;
    })
    .join("\n");

  const breakdown = Object.entries(input.tagBreakdown)
    .sort(([, left], [, right]) => right - left)
    .map(([tag, secs]) => `${tag}: ${Math.round(secs / 60)}min`)
    .join(", ");

  try {
    const result = await generateStructuredData({
      name: "focus_daily_summary",
      description: "Generate a concise daily focus summary for a knowledge worker.",
      prompt: `Generate a short factual summary for ${input.date}.

Total focus time: ${(input.totalSecs / 3600).toFixed(1)}h
Longest streak: ${Math.round(input.longestStreakSecs / 60)}min
App switches: ${input.appSwitches}
Tag breakdown: ${breakdown}

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

function parseTags(tags: string | null | undefined) {
  if (!tags) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}
