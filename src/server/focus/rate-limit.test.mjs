import test from "node:test";
import assert from "node:assert/strict";
import { applyRateLimitWindow } from "./rate-limit-core.ts";

test("applyRateLimitWindow resets count after window expiry", () => {
  const now = new Date("2026-03-29T10:10:00.000Z");
  const existing = {
    count: 4,
    windowStart: new Date("2026-03-29T09:50:00.000Z"),
  };

  const next = applyRateLimitWindow(existing, {
    now,
    maxAttempts: 5,
    windowSecs: 5 * 60,
  });

  assert.equal(next.allowed, true);
  assert.equal(next.count, 1);
  assert.equal(next.remaining, 4);
  assert.equal(next.retryAfterSecs, 0);
});

test("applyRateLimitWindow rejects when max attempts reached inside window", () => {
  const now = new Date("2026-03-29T10:03:00.000Z");
  const existing = {
    count: 5,
    windowStart: new Date("2026-03-29T10:00:00.000Z"),
  };

  const next = applyRateLimitWindow(existing, {
    now,
    maxAttempts: 5,
    windowSecs: 5 * 60,
  });

  assert.equal(next.allowed, false);
  assert.equal(next.count, 5);
  assert.equal(next.remaining, 0);
  assert.equal(next.retryAfterSecs, 120);
});
