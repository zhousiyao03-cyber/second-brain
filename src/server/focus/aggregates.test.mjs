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
  browserUrl: null,
  browserPageTitle: null,
  browserHost: null,
  browserPath: null,
  browserSearchQuery: null,
  browserSurfaceType: null,
  visibleApps: JSON.stringify(["Visual Studio Code"]),
  startedAt: new Date("2026-03-29T23:50:00.000Z"),
  endedAt: new Date("2026-03-30T00:20:00.000Z"),
  durationSecs: 30 * 60,
  tags: JSON.stringify(["editor", "coding"]),
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
  assert.equal(stats.filteredOutSecs, 0);
  assert.equal(stats.tagBreakdown.coding, 20 * 60);
  assert.equal(stats.tagBreakdown.editor, 20 * 60);
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
      browserUrl: "https://github.com/openai/openai-node",
      tags: JSON.stringify(["browser", "git", "coding"]),
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
  assert.equal(displaySessions[0].interruptionCount, 0);
  assert.equal(displaySessions[0].focusedSecs, 44 * 60 + 45);
  assert.equal(displaySessions[0].spanSecs, 45 * 60);
  assert.equal(displaySessions[0].durationSecs, 44 * 60 + 45);
});

test("buildDisplaySessionsFromSlices merges same work across interruptions within ten minutes", () => {
  const slices = [
    {
      ...baseSession,
      id: "coding-a",
      sourceSessionId: "coding-a",
      appName: "Visual Studio Code",
      tags: JSON.stringify(["editor", "coding"]),
      startedAt: new Date("2026-03-30T01:00:00.000Z"),
      endedAt: new Date("2026-03-30T01:50:00.000Z"),
      durationSecs: 50 * 60,
      originalStartedAt: new Date("2026-03-30T01:00:00.000Z"),
      originalEndedAt: new Date("2026-03-30T01:50:00.000Z"),
    },
    {
      ...baseSession,
      id: "chat-a",
      sourceSessionId: "chat-a",
      appName: "Slack",
      tags: JSON.stringify(["communication", "chat"]),
      startedAt: new Date("2026-03-30T01:50:00.000Z"),
      endedAt: new Date("2026-03-30T01:56:00.000Z"),
      durationSecs: 6 * 60,
      originalStartedAt: new Date("2026-03-30T01:50:00.000Z"),
      originalEndedAt: new Date("2026-03-30T01:56:00.000Z"),
    },
    {
      ...baseSession,
      id: "coding-b",
      sourceSessionId: "coding-b",
      appName: "Visual Studio Code",
      tags: JSON.stringify(["editor", "coding"]),
      startedAt: new Date("2026-03-30T01:56:00.000Z"),
      endedAt: new Date("2026-03-30T02:40:00.000Z"),
      durationSecs: 44 * 60,
      originalStartedAt: new Date("2026-03-30T01:56:00.000Z"),
      originalEndedAt: new Date("2026-03-30T02:40:00.000Z"),
    },
  ];

  const displaySessions = buildDisplaySessionsFromSlices(slices);

  assert.equal(displaySessions.length, 1);
  assert.equal(displaySessions[0].displayLabel, "Visual Studio Code");
  assert.equal(displaySessions[0].rawSessionCount, 3);
  assert.equal(displaySessions[0].interruptionCount, 1);
  assert.equal(displaySessions[0].focusedSecs, 94 * 60);
  assert.equal(displaySessions[0].spanSecs, 100 * 60);
  assert.deepEqual(displaySessions[0].mergedSourceSessionIds, [
    "coding-a",
    "chat-a",
    "coding-b",
  ]);
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
        browserUrl: "https://github.com/vercel/next.js",
        tags: JSON.stringify(["browser", "git", "coding"]),
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
  assert.equal(stats.displaySessions[0].interruptionCount, 0);
  assert.equal(stats.focusedSecs, 59 * 60 + 35);
  assert.equal(stats.spanSecs, 60 * 60);
  assert.equal(stats.workHoursSecs, 59 * 60 + 35);
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
        startedAt: new Date("2026-03-30T09:00:00.000Z"),
        endedAt: new Date("2026-03-30T09:30:00.000Z"),
        durationSecs: 30 * 60,
      },
      {
        ...baseSession,
        id: "session-b",
        sourceSessionId: "source-b", 
        appName: "Google Chrome",
        browserUrl: "https://youtube.com/watch?v=123",
        tags: JSON.stringify(["browser", "entertainment"]),
        startedAt: new Date("2026-03-30T09:30:00.000Z"),
        endedAt: new Date("2026-03-30T09:35:00.000Z"),
        durationSecs: 5 * 60,
      },
    ],
  });

  assert.equal(stats.focusedSecs, 35 * 60);
  assert.equal(stats.workHoursSecs, 30 * 60);
  assert.equal(stats.filteredOutSecs, 5 * 60);
  assert.equal(stats.nonWorkBreakdown.entertainment, 5 * 60);
});

test("buildDailyStats groups filtered-out time by non-work reason", () => {
  const stats = buildDailyStats({
    date: "2026-03-30",
    timeZone: "UTC",
    sessions: [
      {
        ...baseSession,
        id: "session-social",
        sourceSessionId: "session-social",
        appName: "WeChat",
        tags: JSON.stringify(["social-media"]),
        startedAt: new Date("2026-03-30T09:00:00.000Z"),
        endedAt: new Date("2026-03-30T09:20:00.000Z"),
        durationSecs: 20 * 60,
      },
      {
        ...baseSession,
        id: "session-video",
        sourceSessionId: "session-video",
        appName: "Google Chrome",
        tags: JSON.stringify(["browser", "entertainment"]),
        startedAt: new Date("2026-03-30T10:00:00.000Z"),
        endedAt: new Date("2026-03-30T10:15:00.000Z"),
        durationSecs: 15 * 60,
      },
    ],
  });

  assert.equal(stats.workHoursSecs, 0);
  assert.equal(stats.filteredOutSecs, 35 * 60);
  assert.equal(stats.nonWorkBreakdown["social-media"], 20 * 60);
  assert.equal(stats.nonWorkBreakdown.entertainment, 15 * 60);
  assert.equal(stats.nonWorkBreakdown.gaming, 0);
});

test("buildDisplaySessionsFromSlices keeps distinct search queries in separate blocks", () => {
  const slices = [
    {
      ...baseSession,
      id: "search-a",
      sourceSessionId: "search-a",
      appName: "Google Chrome",
      browserUrl: "https://www.google.com/search?q=rust+tauri",
      browserPageTitle: "rust tauri - Google Search",
      browserHost: "www.google.com",
      browserPath: "/search",
      browserSearchQuery: "rust tauri",
      browserSurfaceType: "search",
      tags: JSON.stringify(["browser", "reference"]),
      startedAt: new Date("2026-03-30T10:00:00.000Z"),
      endedAt: new Date("2026-03-30T10:08:00.000Z"),
      durationSecs: 8 * 60,
      originalStartedAt: new Date("2026-03-30T10:00:00.000Z"),
      originalEndedAt: new Date("2026-03-30T10:08:00.000Z"),
    },
    {
      ...baseSession,
      id: "search-b",
      sourceSessionId: "search-b",
      appName: "Google Chrome",
      browserUrl: "https://www.google.com/search?q=swift+tauri",
      browserPageTitle: "swift tauri - Google Search",
      browserHost: "www.google.com",
      browserPath: "/search",
      browserSearchQuery: "swift tauri",
      browserSurfaceType: "search",
      tags: JSON.stringify(["browser", "reference"]),
      startedAt: new Date("2026-03-30T10:08:30.000Z"),
      endedAt: new Date("2026-03-30T10:16:00.000Z"),
      durationSecs: 7 * 60 + 30,
      originalStartedAt: new Date("2026-03-30T10:08:30.000Z"),
      originalEndedAt: new Date("2026-03-30T10:16:00.000Z"),
    },
  ];

  const displaySessions = buildDisplaySessionsFromSlices(slices);

  assert.equal(displaySessions.length, 2);
  assert.equal(displaySessions[0].displayLabel, "Search: rust tauri");
  assert.equal(displaySessions[1].displayLabel, "Search: swift tauri");
});

test("buildDisplaySessionsFromSlices merges the same PR across a short interruption", () => {
  const slices = [
    {
      ...baseSession,
      id: "pr-a",
      sourceSessionId: "pr-a",
      appName: "Google Chrome",
      browserUrl: "https://github.com/openai/openai-node/pull/42",
      browserPageTitle: "Improve focus ingestion by teammate",
      browserHost: "github.com",
      browserPath: "/openai/openai-node/pull/42",
      browserSearchQuery: null,
      browserSurfaceType: "pr",
      tags: JSON.stringify(["browser", "git", "coding"]),
      startedAt: new Date("2026-03-30T11:00:00.000Z"),
      endedAt: new Date("2026-03-30T11:12:00.000Z"),
      durationSecs: 12 * 60,
      originalStartedAt: new Date("2026-03-30T11:00:00.000Z"),
      originalEndedAt: new Date("2026-03-30T11:12:00.000Z"),
    },
    {
      ...baseSession,
      id: "interrupt",
      sourceSessionId: "interrupt",
      appName: "Slack",
      browserUrl: null,
      browserPageTitle: null,
      browserHost: null,
      browserPath: null,
      browserSearchQuery: null,
      browserSurfaceType: null,
      tags: JSON.stringify(["communication"]),
      startedAt: new Date("2026-03-30T11:12:10.000Z"),
      endedAt: new Date("2026-03-30T11:12:55.000Z"),
      durationSecs: 45,
      originalStartedAt: new Date("2026-03-30T11:12:10.000Z"),
      originalEndedAt: new Date("2026-03-30T11:12:55.000Z"),
    },
    {
      ...baseSession,
      id: "pr-b",
      sourceSessionId: "pr-b",
      appName: "Google Chrome",
      browserUrl: "https://github.com/openai/openai-node/pull/42",
      browserPageTitle: "Improve focus ingestion by teammate",
      browserHost: "github.com",
      browserPath: "/openai/openai-node/pull/42",
      browserSearchQuery: null,
      browserSurfaceType: "pr",
      tags: JSON.stringify(["browser", "git", "coding"]),
      startedAt: new Date("2026-03-30T11:13:00.000Z"),
      endedAt: new Date("2026-03-30T11:30:00.000Z"),
      durationSecs: 17 * 60,
      originalStartedAt: new Date("2026-03-30T11:13:00.000Z"),
      originalEndedAt: new Date("2026-03-30T11:30:00.000Z"),
    },
  ];

  const displaySessions = buildDisplaySessionsFromSlices(slices);

  assert.equal(displaySessions.length, 1);
  assert.equal(displaySessions[0].displayLabel, "GitHub PR review");
  assert.equal(displaySessions[0].rawSessionCount, 3);
  assert.equal(displaySessions[0].interruptionCount, 1);
});
