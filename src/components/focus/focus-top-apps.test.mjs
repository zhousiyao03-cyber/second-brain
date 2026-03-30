import test from "node:test";
import assert from "node:assert/strict";

import { buildTopApps, FOCUS_TOP_APPS_LIMIT } from "./focus-top-apps.ts";

test("buildTopApps returns up to ten apps sorted by focused time", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    appName: `App ${index + 1}`,
    durationSecs: 60 * (index + 1),
  }));

  const result = buildTopApps(sessions);

  assert.equal(result.length, FOCUS_TOP_APPS_LIMIT);
  assert.deepEqual(
    result.map((entry) => entry.appName),
    [
      "App 12",
      "App 11",
      "App 10",
      "App 9",
      "App 8",
      "App 7",
      "App 6",
      "App 5",
      "App 4",
      "App 3",
    ]
  );
});
