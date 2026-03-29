import test from "node:test";
import assert from "node:assert/strict";
import { FocusSessionizer } from "./sessionizer.mjs";

test("sessionizer keeps extending the current session for the same window", () => {
  const sessionizer = new FocusSessionizer();
  const first = new Date("2026-03-29T09:00:00.000Z");
  const second = new Date("2026-03-29T09:05:00.000Z");

  assert.equal(
    sessionizer.observe(
      { appName: "Visual Studio Code", windowTitle: "auth.ts - second-brain" },
      first,
      0
    ),
    null
  );
  assert.equal(
    sessionizer.observe(
      { appName: "Visual Studio Code", windowTitle: "auth.ts - second-brain" },
      second,
      0
    ),
    null
  );

  const closed = sessionizer.flush(new Date("2026-03-29T09:10:00.000Z"));
  assert.ok(closed);
  assert.equal(closed.appName, "Visual Studio Code");
  assert.equal(closed.durationSecs, 10 * 60);
});

test("sessionizer closes the previous session when the foreground window changes", () => {
  const sessionizer = new FocusSessionizer();

  sessionizer.observe(
    { appName: "Visual Studio Code", windowTitle: "auth.ts - second-brain" },
    new Date("2026-03-29T09:00:00.000Z"),
    0
  );

  const closed = sessionizer.observe(
    { appName: "Google Chrome", windowTitle: "JWT docs" },
    new Date("2026-03-29T09:07:00.000Z"),
    0
  );

  assert.ok(closed);
  assert.equal(closed.appName, "Visual Studio Code");
  assert.equal(closed.durationSecs, 7 * 60);
});

test("sessionizer flushes the current session when idle threshold is exceeded", () => {
  const sessionizer = new FocusSessionizer({ idleThresholdSecs: 300 });

  sessionizer.observe(
    { appName: "Visual Studio Code", windowTitle: "auth.ts - second-brain" },
    new Date("2026-03-29T09:00:00.000Z"),
    0
  );

  const closed = sessionizer.observe(null, new Date("2026-03-29T09:06:00.000Z"), 360);
  assert.ok(closed);
  assert.equal(closed.durationSecs, 6 * 60);
});
