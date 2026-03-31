import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppGroups,
  getDefaultSelectedApp,
  getSelectedAppDetails,
} from "./focus-app-groups.ts";

test("buildAppGroups sorts apps by cumulative duration and computes percentages", () => {
  const groups = buildAppGroups(
    [
      {
        id: "a",
        appName: "Chrome",
        durationSecs: 1200,
        startedAt: new Date("2026-03-31T01:00:00Z"),
        endedAt: new Date("2026-03-31T01:20:00Z"),
      },
      {
        id: "b",
        appName: "Code",
        durationSecs: 2400,
        startedAt: new Date("2026-03-31T02:00:00Z"),
        endedAt: new Date("2026-03-31T02:40:00Z"),
      },
      {
        id: "c",
        appName: "Chrome",
        durationSecs: 600,
        startedAt: new Date("2026-03-31T03:00:00Z"),
        endedAt: new Date("2026-03-31T03:10:00Z"),
      },
    ],
    4200
  );

  assert.equal(groups[0].appName, "Code");
  assert.equal(groups[0].durationSecs, 2400);
  assert.equal(groups[0].percentage, 57);
  assert.equal(groups[1].appName, "Chrome");
  assert.equal(groups[1].durationSecs, 1800);
  assert.equal(groups[1].percentage, 43);
});

test("getSelectedAppDetails returns longest session and first/last seen", () => {
  const details = getSelectedAppDetails("Chrome", [
    {
      id: "a",
      appName: "Chrome",
      durationSecs: 1200,
      startedAt: new Date("2026-03-31T01:00:00Z"),
      endedAt: new Date("2026-03-31T01:20:00Z"),
      windowTitle: "Mail",
    },
    {
      id: "b",
      appName: "Chrome",
      durationSecs: 600,
      startedAt: new Date("2026-03-31T04:00:00Z"),
      endedAt: new Date("2026-03-31T04:10:00Z"),
      windowTitle: "Docs",
    },
  ]);

  assert.equal(details?.sessionCount, 2);
  assert.equal(details?.longestSessionSecs, 1200);
  assert.equal(details?.firstSeenAt.toISOString(), "2026-03-31T01:00:00.000Z");
  assert.equal(details?.lastSeenAt.toISOString(), "2026-03-31T04:10:00.000Z");
});

test("getDefaultSelectedApp returns the top app name", () => {
  assert.equal(
    getDefaultSelectedApp([{ appName: "Code" }, { appName: "Chrome" }]),
    "Code"
  );
  assert.equal(getDefaultSelectedApp([]), null);
});
