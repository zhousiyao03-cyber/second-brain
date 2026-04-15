import assert from "node:assert/strict";
import test from "node:test";
import { parseOpsHostSnapshot } from "./host-snapshot";

test("parseOpsHostSnapshot returns unavailable for malformed JSON", () => {
  const result = parseOpsHostSnapshot("{not-json");
  assert.equal(result.available, false);
  assert.equal(typeof result.reason, "string");
  assert.notEqual(result.reason.length, 0);
});

test("parseOpsHostSnapshot returns typed host data for valid JSON", () => {
  const result = parseOpsHostSnapshot(
    JSON.stringify({
      generatedAt: "2026-04-15T15:00:00.000Z",
      host: {
        uptimeSeconds: 123,
        loadAverage: [0.1, 0.2, 0.3],
        memory: { usedBytes: 10, totalBytes: 20 },
        disk: { usedBytes: 30, totalBytes: 40, mount: "/" },
      },
      services: [{ name: "knosi", status: "healthy", detail: "Up 3m" }],
    })
  );

  assert.equal(result.available, true);
  if (!result.available) {
    throw new Error("expected available host snapshot");
  }
  assert.equal(result.snapshot.host.memory.totalBytes, 20);
});
