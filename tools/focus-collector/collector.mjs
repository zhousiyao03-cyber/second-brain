#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { loadOutbox, saveOutbox } from "./outbox.mjs";
import { getActiveWindowSample, getIdleSeconds } from "./macos-active-window.mjs";
import { FocusSessionizer } from "./sessionizer.mjs";

const args = new Set(process.argv.slice(2));
const outboxPath =
  process.env.FOCUS_COLLECTOR_OUTBOX_PATH ??
  path.join(process.cwd(), "data", "focus-collector", "outbox.json");
const baseUrl = (process.env.FOCUS_COLLECTOR_BASE_URL ?? "http://127.0.0.1:3200").replace(/\/+$/, "");
const apiKey = process.env.FOCUS_COLLECTOR_API_KEY ?? process.env.FOCUS_INGEST_API_KEY ?? "";
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const sampleIntervalMs = Number.parseInt(process.env.FOCUS_COLLECTOR_SAMPLE_INTERVAL_MS ?? "5000", 10);
const idleThresholdSecs = Number.parseInt(process.env.FOCUS_COLLECTOR_IDLE_THRESHOLD_SECS ?? "300", 10);

function log(message, details) {
  if (details === undefined) {
    console.log(`[focus-collector] ${message}`);
    return;
  }
  console.log(`[focus-collector] ${message}`, details);
}

async function uploadQueuedSessions(state, { dryRun }) {
  if (state.queuedSessions.length === 0) {
    return { uploaded: 0, rejected: [] };
  }

  const payload = {
    deviceId: state.deviceId,
    timeZone,
    sessions: state.queuedSessions.map((session) => ({
      sourceSessionId: session.sourceSessionId,
      appName: session.appName,
      windowTitle: session.windowTitle,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    })),
  };

  if (dryRun) {
    log("dry-run upload payload", payload);
    return { uploaded: payload.sessions.length, rejected: [] };
  }

  const response = await fetch(`${baseUrl}/api/focus/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status} ${JSON.stringify(json)}`);
  }

  const accepted = new Set(json.accepted ?? []);
  state.queuedSessions = state.queuedSessions.filter(
    (session) => !accepted.has(session.sourceSessionId)
  );
  await saveOutbox(outboxPath, state);

  return {
    uploaded: accepted.size,
    rejected: Array.isArray(json.rejected) ? json.rejected : [],
  };
}

async function runFixture(state, filePath, { dryRun }) {
  const fixture = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  if (!Array.isArray(fixture)) {
    throw new Error("fixture must be an array of sessions");
  }
  state.queuedSessions.push(...fixture);
  await saveOutbox(outboxPath, state);
  const result = await uploadQueuedSessions(state, { dryRun });
  log("fixture upload result", result);
}

async function main() {
  const dryRun = args.has("--dry-run");
  const once = args.has("--once");
  const flushOnly = args.has("--flush");
  const fixtureIndex = process.argv.indexOf("--fixture");
  const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : null;
  const state = await loadOutbox(outboxPath);
  const sessionizer = new FocusSessionizer({ idleThresholdSecs });

  log("collector starting", {
    baseUrl,
    outboxPath,
    deviceId: state.deviceId || os.hostname(),
    timeZone,
    dryRun,
    once,
  });

  if (fixturePath) {
    await runFixture(state, fixturePath, { dryRun });
    return;
  }

  if (flushOnly) {
    const flushed = sessionizer.flush(new Date());
    if (flushed) {
      state.queuedSessions.push(flushed);
      await saveOutbox(outboxPath, state);
    }
    const result = await uploadQueuedSessions(state, { dryRun });
    log("flush result", result);
    return;
  }

  const tick = async () => {
    const observedAt = new Date();
    const idleSecs = await getIdleSeconds().catch(() => 0);
    const sample = idleSecs >= idleThresholdSecs ? null : await getActiveWindowSample().catch(() => null);
    const closed = sessionizer.observe(sample, observedAt, idleSecs);

    if (closed) {
      state.queuedSessions.push({
        ...closed,
        startedAt: closed.startedAt.toISOString(),
        endedAt: closed.endedAt.toISOString(),
      });
      await saveOutbox(outboxPath, state);
      log("queued session", {
        appName: closed.appName,
        windowTitle: closed.windowTitle,
        durationSecs: closed.durationSecs,
      });
    }

    if (state.queuedSessions.length > 0) {
      const result = await uploadQueuedSessions(state, { dryRun });
      if (result.uploaded > 0 || result.rejected.length > 0) {
        log("upload result", result);
      }
    }
  };

  await tick();
  if (once) {
    const flushed = sessionizer.flush(new Date());
    if (flushed) {
      state.queuedSessions.push({
        ...flushed,
        startedAt: flushed.startedAt.toISOString(),
        endedAt: flushed.endedAt.toISOString(),
      });
      await saveOutbox(outboxPath, state);
      const result = await uploadQueuedSessions(state, { dryRun });
      log("single-run result", result);
    }
    return;
  }

  const timer = setInterval(() => {
    void tick().catch((error) => {
      console.error("[focus-collector] tick failed", error);
    });
  }, sampleIntervalMs);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      clearInterval(timer);
      const flushed = sessionizer.flush(new Date());
      if (flushed) {
        state.queuedSessions.push({
          ...flushed,
          startedAt: flushed.startedAt.toISOString(),
          endedAt: flushed.endedAt.toISOString(),
        });
        await saveOutbox(outboxPath, state);
      }
      await uploadQueuedSessions(state, { dryRun }).catch(() => undefined);
      process.exit(0);
    });
  }
}

await main().catch((error) => {
  console.error("[focus-collector] fatal", error);
  process.exit(1);
});
