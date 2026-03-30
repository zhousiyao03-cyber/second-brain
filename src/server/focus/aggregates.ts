import { countsTowardWorkHours } from "./tags.js";

export type FocusSessionRecord = {
  id: string;
  userId: string;
  sourceDeviceId: string;
  sourceSessionId: string;
  appName: string;
  windowTitle: string | null;
  browserUrl: string | null;
  browserPageTitle: string | null;
  visibleApps: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSecs: number;
  tags: string | null;
  aiSummary: string | null;
  ingestionStatus: string;
  ingestedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type FocusSessionSlice = FocusSessionRecord & {
  durationSecs: number;
  originalEndedAt: Date;
  originalStartedAt: Date;
};

export type FocusDisplaySession = FocusSessionSlice & {
  id: string;
  sourceSessionId: string;
  spanSecs: number;
  focusedSecs: number;
  rawSessionCount: number;
  interruptionCount: number;
  mergedSourceSessionIds: string[];
};

type DayRangeOptions = {
  date: string;
  timeZone: string;
};

type SliceSessionOptions = DayRangeOptions & {
  session: FocusSessionRecord;
};

type BuildDailyStatsOptions = DayRangeOptions & {
  sessions: FocusSessionRecord[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STREAK_GAP_SECS = 120;
const DISPLAY_MERGE_GAP_SECS = 120;
const DISPLAY_TRANSIENT_SECS = 120;

export function addDaysToDateString(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function parseOffsetMillis(offsetText: string) {
  if (offsetText === "GMT" || offsetText === "UTC") {
    return 0;
  }

  const match = offsetText.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    throw new Error(`Unsupported timezone offset format: ${offsetText}`);
  }

  const [, sign, hours, minutes = "00"] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);
  return (sign === "-" ? -1 : 1) * totalMinutes * 60 * 1000;
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const timeZoneName = formatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!timeZoneName) {
    throw new Error(`Unable to resolve timezone offset for ${timeZone}`);
  }

  return parseOffsetMillis(timeZoneName);
}

function zonedDateTimeToUtc(date: string, timeZone: string, hour = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const offset = getTimeZoneOffsetMillis(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

export function getLocalDayRange({ date, timeZone }: DayRangeOptions) {
  const start = zonedDateTimeToUtc(date, timeZone, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end };
}

export function sliceSessionForDay({
  session,
  date,
  timeZone,
}: SliceSessionOptions): FocusSessionSlice | null {
  const { start, end } = getLocalDayRange({ date, timeZone });
  const overlapStart = Math.max(session.startedAt.getTime(), start.getTime());
  const overlapEnd = Math.min(session.endedAt.getTime(), end.getTime());

  if (overlapEnd <= overlapStart) {
    return null;
  }

  return {
    ...session,
    originalStartedAt: session.startedAt,
    originalEndedAt: session.endedAt,
    startedAt: new Date(overlapStart),
    endedAt: new Date(overlapEnd),
    durationSecs: Math.floor((overlapEnd - overlapStart) / 1000),
  };
}

export function buildDailyStats({
  sessions,
  date,
  timeZone,
}: BuildDailyStatsOptions) {
  const slices = sessions
    .map((session) => sliceSessionForDay({ session, date, timeZone }))
    .filter((session): session is FocusSessionSlice => Boolean(session))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const tagBreakdown: Record<string, number> = {};
  let totalSecs = 0;
  let appSwitches = 0;
  let longestStreakSecs = 0;
  let currentStreakSecs = 0;

  for (const [index, slice] of slices.entries()) {
    totalSecs += slice.durationSecs;
    const tags = parseJsonStringArray(slice.tags);
    for (const tag of tags) {
      tagBreakdown[tag] = (tagBreakdown[tag] ?? 0) + slice.durationSecs;
    }

    const previous = slices[index - 1];
    if (previous) {
      if (slice.appName !== previous.appName) {
        appSwitches += 1;
      }

      const gapSecs = Math.floor((slice.startedAt.getTime() - previous.endedAt.getTime()) / 1000);
      if (gapSecs <= STREAK_GAP_SECS) {
        currentStreakSecs += slice.durationSecs;
      } else {
        currentStreakSecs = slice.durationSecs;
      }
    } else {
      currentStreakSecs = slice.durationSecs;
    }

    longestStreakSecs = Math.max(longestStreakSecs, currentStreakSecs);
  }

  const displaySessions = buildDisplaySessionsFromSlices(slices);
  const workHoursSecs = displaySessions.reduce((sum, session) => {
    const tags = parseJsonStringArray(session.tags);
    return countsTowardWorkHours(tags) ? sum + session.focusedSecs : sum;
  }, 0);

  return {
    totalSecs,
    focusedSecs: displaySessions.reduce((sum, session) => sum + session.focusedSecs, 0),
    spanSecs: displaySessions.reduce((sum, session) => sum + session.spanSecs, 0),
    workHoursSecs,
    tagBreakdown,
    longestStreakSecs,
    appSwitches,
    sessionCount: slices.length,
    displaySessions,
    sessions: slices,
  };
}

function sharesDisplayGroup(
  left: Pick<FocusSessionSlice, "appName" | "tags">,
  right: Pick<FocusSessionSlice, "appName" | "tags">
) {
  const leftTags = parseJsonStringArray(left.tags);
  const rightTags = parseJsonStringArray(right.tags);

  if (leftTags.length > 0 && rightTags.length > 0) {
    const shared = leftTags.some((tag) => rightTags.includes(tag));
    if (shared) {
      return true;
    }
  }

  return left.appName === right.appName;
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toDisplaySession(slice: FocusSessionSlice): FocusDisplaySession {
  return {
    ...slice,
    id: `display-${slice.sourceSessionId}`,
    sourceSessionId: `display-${slice.sourceSessionId}`,
    spanSecs: slice.durationSecs,
    focusedSecs: slice.durationSecs,
    rawSessionCount: 1,
    interruptionCount: 0,
    mergedSourceSessionIds: [slice.sourceSessionId],
  };
}

function mergeIntoDisplaySession(
  base: FocusDisplaySession,
  next: FocusSessionSlice,
  options?: { interruptionCount?: number }
): FocusDisplaySession {
  const endedAt = next.endedAt > base.endedAt ? next.endedAt : base.endedAt;
  return {
    ...base,
    endedAt,
    durationSecs: base.focusedSecs + next.durationSecs,
    spanSecs:
      Math.floor((endedAt.getTime() - base.startedAt.getTime()) / 1000) || base.spanSecs,
    focusedSecs: base.focusedSecs + next.durationSecs,
    rawSessionCount: base.rawSessionCount + 1,
    interruptionCount: base.interruptionCount + (options?.interruptionCount ?? 0),
    mergedSourceSessionIds: [...base.mergedSourceSessionIds, next.sourceSessionId],
  };
}

function mergeDisplaySessions(
  base: FocusDisplaySession,
  transient: FocusSessionSlice,
  next: FocusDisplaySession
): FocusDisplaySession {
  return {
    ...base,
    endedAt: next.endedAt,
    durationSecs: base.focusedSecs + next.focusedSecs,
    spanSecs: Math.floor((next.endedAt.getTime() - base.startedAt.getTime()) / 1000),
    focusedSecs: base.focusedSecs + next.focusedSecs,
    rawSessionCount: base.rawSessionCount + next.rawSessionCount + 1,
    interruptionCount:
      base.interruptionCount + next.interruptionCount + 1,
    mergedSourceSessionIds: [
      ...base.mergedSourceSessionIds,
      transient.sourceSessionId,
      ...next.mergedSourceSessionIds,
    ],
  };
}

export function buildDisplaySessionsFromSlices(
  slices: FocusSessionSlice[]
): FocusDisplaySession[] {
  if (slices.length === 0) {
    return [];
  }

  const collapsed = slices.reduce<FocusDisplaySession[]>((acc, slice) => {
    const previous = acc.at(-1);
    if (!previous) {
      acc.push(toDisplaySession(slice));
      return acc;
    }

    const gapSecs = Math.floor(
      (slice.startedAt.getTime() - previous.endedAt.getTime()) / 1000
    );

    if (gapSecs <= DISPLAY_MERGE_GAP_SECS && sharesDisplayGroup(previous, slice)) {
      acc[acc.length - 1] = mergeIntoDisplaySession(previous, slice);
      return acc;
    }

    acc.push(toDisplaySession(slice));
    return acc;
  }, []);

  const merged: FocusDisplaySession[] = [];

  for (let index = 0; index < collapsed.length; index += 1) {
    const current = collapsed[index];
    const previous = merged.at(-1);
    const next = collapsed[index + 1];

    if (
      previous &&
      next &&
      current.durationSecs < DISPLAY_TRANSIENT_SECS &&
      sharesDisplayGroup(previous, next)
    ) {
      const previousGap = Math.floor(
        (current.startedAt.getTime() - previous.endedAt.getTime()) / 1000
      );
      const nextGap = Math.floor(
        (next.startedAt.getTime() - current.endedAt.getTime()) / 1000
      );

      if (
        previousGap <= DISPLAY_MERGE_GAP_SECS &&
        nextGap <= DISPLAY_MERGE_GAP_SECS
      ) {
        merged[merged.length - 1] = mergeDisplaySessions(previous, current, next);
        index += 1;
        continue;
      }
    }

    merged.push(current);
  }

  return merged;
}

export function buildWeeklyStats({
  sessions,
  weekStart,
  timeZone,
}: {
  sessions: FocusSessionRecord[];
  weekStart: string;
  timeZone: string;
}) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDateString(weekStart, index);
    const daily = buildDailyStats({ sessions, date, timeZone });
    return {
      date,
      totalSecs: daily.totalSecs,
      focusedSecs: daily.focusedSecs,
      workHoursSecs: daily.workHoursSecs,
      tagBreakdown: daily.tagBreakdown,
    };
  });
}
