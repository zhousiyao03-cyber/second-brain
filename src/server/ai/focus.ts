import { z } from "zod/v4";
import { generateStructuredData } from "./provider";

const FOCUS_AI_TIMEOUT_MS = 4_000;

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
  if (session.displayLabel?.trim()) {
    return `${session.displayLabel} for ${formatDurationShort(session.durationSecs)}`;
  }

  if (session.browserSearchQuery?.trim()) {
    return `Searched for ${session.browserSearchQuery} in ${session.appName}`;
  }

  if (session.browserPageTitle?.trim()) {
    return `${session.browserPageTitle} in ${session.appName}`;
  }

  const title = session.windowTitle?.trim();
  if (title) {
    return `${title} in ${session.appName}`;
  }
  return `Worked in ${session.appName} for ${formatDurationShort(session.durationSecs)}`;
}

function createFocusAiTimeoutSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(FOCUS_AI_TIMEOUT_MS);
  }

  return undefined;
}

function normalizeGeneratedText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
  browserPageTitle?: string | null;
  browserSearchQuery?: string | null;
  browserSurfaceType?: string | null;
  displayLabel?: string | null;
  tags: string | null;
  durationSecs: number;
};

type SessionForSummary = {
  appName: string;
  windowTitle: string | null;
  browserUrl: string | null;
  browserPageTitle?: string | null;
  browserSearchQuery?: string | null;
  browserSurfaceType?: string | null;
  displayLabel?: string | null;
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
        `- id=${session.id} | app=${session.appName} | label=${session.displayLabel ?? "(none)"} | title=${session.windowTitle ?? "(no title)"} | page=${session.browserPageTitle ?? "(no page title)"} | surface=${session.browserSurfaceType ?? "unknown"} | query=${session.browserSearchQuery ?? "(none)"} | duration=${Math.max(1, Math.round(session.durationSecs / 60))}min`
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
      signal: createFocusAiTimeoutSignal(),
    });

    return result.sessions.map((session) => ({
      id: session.id,
      summary:
        normalizeGeneratedText(session.summary) ??
        fallbackSessionSummary(
          sessions.find((candidate) => candidate.id === session.id) ?? sessions[0]
        ),
    }));
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
      const summary =
        session.displayLabel ??
        session.aiSummary ??
        session.browserPageTitle ??
        session.windowTitle ??
        session.appName;
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
      signal: createFocusAiTimeoutSignal(),
    });

    return (
      normalizeGeneratedText(result.summary) ??
      `Focused for ${formatDurationShort(input.totalSecs)} on ${input.date}, mostly in ${topLabelsFromSessions(input.sessions).join(", ")}. Longest streak was ${formatDurationShort(input.longestStreakSecs)} with ${input.appSwitches} app switches.`
    );
  } catch {
    return `Focused for ${formatDurationShort(input.totalSecs)} on ${input.date}, mostly in ${topLabelsFromSessions(input.sessions).join(", ")}. Longest streak was ${formatDurationShort(input.longestStreakSecs)} with ${input.appSwitches} app switches.`;
  }
}

function topLabelsFromSessions(sessions: SessionForSummary[]) {
  return [
    ...new Set(
      sessions.map(
        (session) =>
          session.displayLabel ??
          session.browserPageTitle ??
          session.windowTitle ??
          session.appName
      )
    ),
  ].slice(0, 3);
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
