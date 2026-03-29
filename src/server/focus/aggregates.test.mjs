import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyStats,
  buildDisplaySessionsFromSlices,
  sliceSessionForDay,
} from "./aggregates.ts";

const baseSession = {
  id: "session-1",
  userId: "user-1",
  sourceDeviceId: "device-1",
  sourceSessionId: "source-session-1",
  appName: "Visual Studio Code",
  windowTitle: "auth.ts - second-brain",
  startedAt: new Date("2026-03-29T23:50:00.000Z"),
  endedAt: new Date("2026-03-30T00:20:00.000Z"),
  durationSecs: 30 * 60,
  category: "coding",
  aiSummary: "Worked on auth flow",
  ingestionStatus: "processed",
  ingestedAt: new Date("2026-03-30T00:20:05.000Z"),
  createdAt: new Date("2026-03-30T00:20:05.000Z"),
  updatedAt: new Date("2026-03-30T00:20:05.000Z"),
};

test("sliceSessionForDay clips a midnight-crossing session to the selected day", () => {
  const slice = sliceSessionForDay({
    session: baseSession,
    date: "2026-03-30",
    timeZone: "UTC",
  });

  assert.ok(slice);
  assert.equal(slice.startedAt.toISOString(), "2026-03-30T00:00:00.000Z");
  assert.equal(slice.endedAt.toISOString(), "2026-03-30T00:20:00.000Z");
  assert.equal(slice.durationSecs, 20 * 60);
});

test("buildDailyStats counts only overlapped seconds for the selected day", () => {
  const stats = buildDailyStats({
    sessions: [baseSession],
    date: "2026-03-30",
    timeZone: "UTC",
  });

  assert.equal(stats.totalSecs, 20 * 60);
  assert.equal(stats.focusedSecs, 20 * 60);
  assert.equal(stats.spanSecs, 20 * 60);
  assert.equal(stats.workHoursSecs, 20 * 60);
  assert.equal(stats.categoryBreakdown.coding, 20 * 60);
  assert.equal(stats.appSwitches, 0);
});

test("buildDailyStats breaks longest streak when the gap is larger than two minutes", () => {
  const stats = buildDailyStats({
    date: "2026-03-30",
    timeZone: "UTC",
    sessions: [
      {
        ...baseSession,
        id: "session-a",
        sourceSessionId: "source-a",
        startedAt: new Date("2026-03-30T01:00:00.000Z"),
        endedAt: new Date("2026-03-30T01:25:00.000Z"),
        durationSecs: 25 * 60,
      },
      {
        ...baseSession,
        id: "session-b",
        sourceSessionId: "source-b",
        startedAt: new Date("2026-03-30T01:26:30.000Z"),
        endedAt: new Date("2026-03-30T01:43:30.000Z"),
        durationSecs: 17 * 60,
      },
      {
        ...baseSession,
        id: "session-c",
        sourceSessionId: "source-c",
        startedAt: new Date("2026-03-30T01:50:30.000Z"),
        endedAt: new Date("2026-03-30T02:10:30.000Z"),
        durationSecs: 20 * 60,
      },
    ],
  });

  assert.equal(stats.totalSecs, 62 * 60);
  assert.equal(stats.longestStreakSecs, 42 * 60);
  assert.equal(stats.appSwitches, 0);
});

test("buildDisplaySessionsFromSlices merges short interruptions into the surrounding block", () => {
  const slices = [
    {
      ...baseSession,
      id: "session-a",
      sourceSessionId: "source-a",
      appName: "Visual Studio Code",
      category: "coding",
      startedAt: new Date("2026-03-30T01:00:00.000Z"),
      endedAt: new Date("2026-03-30T01:20:00.000Z"),
      durationSecs: 20 * 60,
      originalStartedAt: new Date("2026-03-30T01:00:00.000Z"),
      originalEndedAt: new Date("2026-03-30T01:20:00.000Z"),
    },
    {
      ...baseSession,
      id: "session-b",
      sourceSessionId: "source-b",
      appName: "Google Chrome",
      category: "research",
      startedAt: new Date("2026-03-30T01:20:10.000Z"),
      endedAt: new Date("2026-03-30T01:20:55.000Z"),
      durationSecs: 45,
      originalStartedAt: new Date("2026-03-30T01:20:10.000Z"),
      originalEndedAt: new Date("2026-03-30T01:20:55.000Z"),
    },
    {
      ...baseSession,
      id: "session-c",
      sourceSessionId: "source-c",
      appName: "Visual Studio Code",
      category: "coding",
      startedAt: new Date("2026-03-30T01:21:00.000Z"),
      endedAt: new Date("2026-03-30T01:45:00.000Z"),
      durationSecs: 24 * 60,
      originalStartedAt: new Date("2026-03-30T01:21:00.000Z"),
      originalEndedAt: new Date("2026-03-30T01:45:00.000Z"),
    },
  ];

  const displaySessions = buildDisplaySessionsFromSlices(slices);

  assert.equal(displaySessions.length, 1);
  assert.equal(displaySessions[0].rawSessionCount, 3);
  assert.equal(displaySessions[0].interruptionCount, 1);
  assert.equal(displaySessions[0].focusedSecs, 44 * 60);
  assert.equal(displaySessions[0].spanSecs, 45 * 60);
  assert.equal(displaySessions[0].durationSecs, 44 * 60);
});

test("buildDailyStats exposes merged display sessions for UI consumption", () => {
  const stats = buildDailyStats({
    date: "2026-03-30",
    timeZone: "UTC",
    sessions: [
      {
        ...baseSession,
        id: "session-a",
        sourceSessionId: "source-a",
        appName: "Visual Studio Code",
        startedAt: new Date("2026-03-30T09:00:00.000Z"),
        endedAt: new Date("2026-03-30T09:40:00.000Z"),
        durationSecs: 40 * 60,
      },
      {
        ...baseSession,
        id: "session-b",
        sourceSessionId: "source-b",
        appName: "Google Chrome",
        category: "research",
        startedAt: new Date("2026-03-30T09:40:20.000Z"),
        endedAt: new Date("2026-03-30T09:41:00.000Z"),
        durationSecs: 40,
      },
      {
        ...baseSession,
        id: "session-c",
        sourceSessionId: "source-c",
        appName: "Visual Studio Code",
        startedAt: new Date("2026-03-30T09:41:05.000Z"),
        endedAt: new Date("2026-03-30T10:00:00.000Z"),
        durationSecs: 19 * 60 - 5,
      },
    ],
  });

  assert.equal(stats.sessions.length, 3);
  assert.equal(stats.displaySessions.length, 1);
  assert.equal(stats.displaySessions[0].interruptionCount, 1);
  assert.equal(stats.focusedSecs, 59 * 60 - 5);
  assert.equal(stats.spanSecs, 60 * 60);
  assert.equal(stats.workHoursSecs, 59 * 60 - 5);
});

test("workHours excludes sessions that resolve to other", () => {
  const stats = buildDailyStats({
    date: "2026-03-30",
    timeZone: "UTC",
    sessions: [
      {
        ...baseSession,
        id: "session-a",
        sourceSessionId: "source-a",
        appName: "Visual Studio Code",
        category: "coding",
        startedAt: new Date("2026-03-30T09:00:00.000Z"),
        endedAt: new Date("2026-03-30T09:30:00.000Z"),
        durationSecs: 30 * 60,
      },
      {
        ...baseSession,
        id: "session-b",
        sourceSessionId: "source-b",
        appName: "Finder",
        category: "other",
        startedAt: new Date("2026-03-30T09:30:00.000Z"),
        endedAt: new Date("2026-03-30T09:35:00.000Z"),
        durationSecs: 5 * 60,
      },
    ],
  });

  assert.equal(stats.focusedSecs, 35 * 60);
  assert.equal(stats.workHoursSecs, 30 * 60);
});
