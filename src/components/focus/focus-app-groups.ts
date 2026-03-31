type AppSession = {
  id: string;
  appName: string;
  durationSecs: number;
  startedAt: string | Date;
  endedAt: string | Date;
  windowTitle?: string | null;
  browserHost?: string | null;
};

export type FocusAppGroup = {
  appName: string;
  durationSecs: number;
  percentage: number;
  sessionCount: number;
};

export type FocusSelectedAppDetails = {
  appName: string;
  durationSecs: number;
  sessionCount: number;
  longestSessionSecs: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sessions: AppSession[];
};

export function buildAppGroups(sessions: AppSession[], totalSecs: number) {
  const groups = new Map<string, FocusAppGroup>();

  for (const session of sessions) {
    const current = groups.get(session.appName) ?? {
      appName: session.appName,
      durationSecs: 0,
      percentage: 0,
      sessionCount: 0,
    };

    current.durationSecs += session.durationSecs;
    current.sessionCount += 1;
    groups.set(session.appName, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      percentage:
        totalSecs > 0 ? Math.max(1, Math.round((group.durationSecs / totalSecs) * 100)) : 0,
    }))
    .sort((left, right) => right.durationSecs - left.durationSecs);
}

export function getDefaultSelectedApp(groups: Array<{ appName: string }>) {
  return groups[0]?.appName ?? null;
}

export function getSelectedAppDetails(appName: string | null, sessions: AppSession[]) {
  if (!appName) {
    return null;
  }

  const appSessions = sessions.filter((session) => session.appName === appName);
  if (!appSessions.length) {
    return null;
  }

  const sortedSessions = [...appSessions].sort(
    (left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
  );

  return {
    appName,
    durationSecs: sortedSessions.reduce((sum, session) => sum + session.durationSecs, 0),
    sessionCount: sortedSessions.length,
    longestSessionSecs: sortedSessions.reduce(
      (longest, session) => Math.max(longest, session.durationSecs),
      0
    ),
    firstSeenAt: new Date(sortedSessions[0].startedAt),
    lastSeenAt: new Date(sortedSessions[sortedSessions.length - 1].endedAt),
    sessions: sortedSessions,
  } satisfies FocusSelectedAppDetails;
}
