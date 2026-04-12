/**
 * HTTP API client — communicates with the hosted Second Brain server.
 */

let serverUrl = "";

export function configure(url) {
  serverUrl = url.replace(/\/+$/, "");
}

export async function claimTask(taskType) {
  const res = await fetch(`${serverUrl}/api/chat/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.task ?? null;
}

export async function pushChatProgress(taskId, messages) {
  if (messages.length === 0) return;
  await fetch(`${serverUrl}/api/chat/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, messages }),
  });
}

export async function completeTask(taskId, { totalText, structuredResult, error } = {}) {
  const body = { taskId };
  if (error) {
    body.error = error;
  } else {
    if (totalText != null) body.totalText = totalText;
    if (structuredResult != null) body.structuredResult = structuredResult;
  }
  const res = await fetch(`${serverUrl}/api/chat/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Complete API ${res.status}: ${await res.text()}`);
  }
}

export async function sendHeartbeat(kind) {
  await fetch(`${serverUrl}/api/daemon/ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, version: "@knosi/cli" }),
  }).catch(() => {});
}
