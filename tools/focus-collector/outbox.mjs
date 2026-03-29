import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function defaultState() {
  return {
    deviceId: crypto.randomUUID(),
    queuedSessions: [],
  };
}

export async function loadOutbox(outboxPath) {
  try {
    const content = await readFile(outboxPath, "utf8");
    const parsed = JSON.parse(content);
    return {
      deviceId: parsed.deviceId ?? crypto.randomUUID(),
      queuedSessions: Array.isArray(parsed.queuedSessions) ? parsed.queuedSessions : [],
    };
  } catch {
    return defaultState();
  }
}

export async function saveOutbox(outboxPath, state) {
  await mkdir(path.dirname(outboxPath), { recursive: true });
  await writeFile(
    outboxPath,
    `${JSON.stringify(
      {
        deviceId: state.deviceId,
        queuedSessions: state.queuedSessions,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
