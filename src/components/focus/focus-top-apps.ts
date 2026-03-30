export const FOCUS_TOP_APPS_LIMIT = 10;

export type FocusTopAppSession = {
  appName: string;
  durationSecs: number;
  focusedSecs?: number;
};

export function buildTopApps(
  sessions: FocusTopAppSession[],
  limit = FOCUS_TOP_APPS_LIMIT
) {
  const byApp = new Map<
    string,
    { appName: string; durationSecs: number; sessions: number }
  >();

  for (const session of sessions) {
    const current = byApp.get(session.appName) ?? {
      appName: session.appName,
      durationSecs: 0,
      sessions: 0,
    };
    current.durationSecs += session.focusedSecs ?? session.durationSecs;
    current.sessions += 1;
    byApp.set(session.appName, current);
  }

  return [...byApp.values()]
    .sort((left, right) => right.durationSecs - left.durationSecs)
    .slice(0, limit);
}
