import test from "node:test";
import assert from "node:assert/strict";

import { getNextDailyPingAt } from "./daily-ping-scheduler.mjs";

test("schedules same-day ping when current time is before 05:59 local", () => {
  const next = getNextDailyPingAt(new Date("2026-04-09T05:58:00+08:00"));

  assert.equal(next.toISOString(), "2026-04-08T21:59:00.000Z");
});

test("schedules next-day ping when current time is after 05:59 local", () => {
  const next = getNextDailyPingAt(new Date("2026-04-09T23:33:27+08:00"));

  assert.equal(next.toISOString(), "2026-04-09T21:59:00.000Z");
});

test("keeps exact 05:59 aligned when already at the slot", () => {
  const next = getNextDailyPingAt(new Date("2026-04-09T05:59:00+08:00"));

  assert.equal(next.toISOString(), "2026-04-08T21:59:00.000Z");
});
