"use client";

export { buildTopApps } from "./focus-top-apps";

type FocusSessionSlice = {
  id: string;
  appName: string;
  windowTitle: string | null;
  browserUrl?: string | null;
  browserPageTitle?: string | null;
  browserHost?: string | null;
  browserPath?: string | null;
  browserSearchQuery?: string | null;
  browserSurfaceType?: string | null;
  displayLabel?: string | null;
  startedAt: string | Date;
  endedAt: string | Date;
  durationSecs: number;
  focusedSecs?: number;
  spanSecs?: number;
  tags?: string[] | string | null;
  interruptionCount?: number;
  contextApps?: string[] | string | null;
};

const DAY_SECS = 24 * 60 * 60;
const timelinePalette = [
  "bg-teal-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-lime-400",
  "bg-cyan-400",
];

export function formatFocusDuration(totalSecs: number) {
  if (totalSecs > 0 && totalSecs < 60) {
    return "<1m";
  }

  const minutes = Math.floor(totalSecs / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `${Math.max(remainingMinutes, 0)}m`;
  }

  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`;
}

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatClockLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getFocusSessionLabel(session: FocusSessionSlice) {
  if (session.displayLabel) {
    return session.displayLabel;
  }

  if (session.browserSurfaceType === "search" && session.browserSearchQuery) {
    return `Search: ${session.browserSearchQuery}`;
  }

  if (session.browserSurfaceType === "pr") {
    return "GitHub PR review";
  }

  if (session.browserSurfaceType === "issue") {
    return "GitHub issue review";
  }

  if (session.browserSurfaceType === "repo") {
    return "GitHub repository";
  }

  if (session.browserSurfaceType === "chat") {
    return session.browserPageTitle || "AI chat";
  }

  if (session.browserSurfaceType === "docs") {
    return session.browserPageTitle || "Documentation";
  }

  if (session.browserSurfaceType === "design") {
    return session.browserPageTitle || "Design review";
  }

  if (session.browserSurfaceType === "mail") {
    return "Mail";
  }

  if (session.browserSurfaceType === "calendar") {
    return "Calendar";
  }

  if (session.browserSurfaceType === "video") {
    return session.browserPageTitle || "Video";
  }

  return session.browserPageTitle || session.appName;
}

function getSegmentColor(appName: string) {
  const hash = [...appName].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return timelinePalette[hash % timelinePalette.length];
}

export function FocusTimeline({
  sessions,
  testId,
  compact = false,
  selectedAppName,
}: {
  sessions: FocusSessionSlice[];
  testId?: string;
  compact?: boolean;
  selectedAppName?: string | null;
}) {
  return (
    <div data-testid={testId} className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
        <span>00</span>
        <span>08</span>
        <span>16</span>
        <span>24</span>
      </div>
      <div className="relative h-5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-900">
        <div className="absolute inset-y-0 left-1/3 w-px bg-stone-200 dark:bg-stone-800" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-stone-200 dark:bg-stone-800" />
        {sessions.map((session) => {
          const startedAt = new Date(session.startedAt);
          const endedAt = new Date(session.endedAt);
          const startOffsetSecs =
            startedAt.getHours() * 3600 +
            startedAt.getMinutes() * 60 +
            startedAt.getSeconds();
          const endOffsetSecs =
            endedAt.getHours() * 3600 +
            endedAt.getMinutes() * 60 +
            endedAt.getSeconds();
          const durationSecs = Math.max(60, endOffsetSecs - startOffsetSecs);

          return (
            <div
              key={session.id}
              title={`${session.appName} • ${formatClockLabel(session.startedAt)}-${formatClockLabel(session.endedAt)}`}
              className={`absolute inset-y-1 rounded-full ${getSegmentColor(session.appName)} ${
                selectedAppName && session.appName !== selectedAppName ? "opacity-25" : ""
              }`}
              style={{
                left: `${(startOffsetSecs / DAY_SECS) * 100}%`,
                width: `${Math.max((durationSecs / DAY_SECS) * 100, compact ? 1 : 0.6)}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
