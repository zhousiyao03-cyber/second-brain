import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOverallStatus } from "./page-data";

test("summarizeOverallStatus returns degraded when daemon is stale", () => {
  const result = summarizeOverallStatus({
    services: [
      { name: "knosi", status: "healthy" },
      { name: "redis", status: "healthy" },
      { name: "caddy", status: "healthy" },
      { name: "daemon", status: "degraded" },
    ],
    queue: {
      queued: 0,
      running: 1,
      failedRecent: 0,
    },
    host: { available: true },
    cron: {
      jobsTick: { status: "healthy" },
      cleanupStaleChatTasks: { status: "healthy" },
    },
  });

  assert.equal(result, "degraded");
});

test("summarizeOverallStatus returns healthy when all subsystems are healthy", () => {
  const result = summarizeOverallStatus({
    services: [
      { name: "knosi", status: "healthy" },
      { name: "redis", status: "healthy" },
      { name: "caddy", status: "healthy" },
      { name: "daemon", status: "healthy" },
    ],
    queue: {
      queued: 0,
      running: 0,
      failedRecent: 0,
    },
    host: { available: true },
    cron: {
      jobsTick: { status: "healthy" },
      cleanupStaleChatTasks: { status: "healthy" },
    },
  });

  assert.equal(result, "healthy");
});
