/**
 * HTTP API client — communicates with the hosted Second Brain server.
 */
import { consumeDaemonNotificationStream } from "./daemon-notifications.mjs";

let serverUrl = "";
let authToken = "";

export function configure(url) {
  serverUrl = url.replace(/\/+$/, "");
}

export function setAuthToken(token) {
  authToken = token;
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  return headers;
}

export async function claimTask(taskType) {
  const res = await fetch(`${serverUrl}/api/chat/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ taskType }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("AUTH_FAILED");
    return null;
  }
  const data = await res.json();
  return data.task ?? null;
}

export async function pushChatProgress(taskId, messages) {
  if (messages.length === 0) return;
  await fetch(`${serverUrl}/api/chat/progress`, {
    method: "POST",
    headers: authHeaders(),
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
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Complete API ${res.status}: ${await res.text()}`);
  }
}

export async function sendHeartbeat(kind) {
  await fetch(`${serverUrl}/api/daemon/ping`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ kind, version: "@knosi/cli" }),
  }).catch(() => {});
}

export async function connectDaemonTaskNotifications({ signal } = {}, onEvent) {
  const headers = { Accept: "text/event-stream" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${serverUrl}/api/daemon/tasks`, {
    method: "GET",
    headers,
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("AUTH_FAILED");
    throw new Error(`Daemon notifications ${res.status}`);
  }

  await consumeDaemonNotificationStream(res, onEvent);
}

export async function createAuthSession(serverUrl) {
  const res = await fetch(`${serverUrl}/api/cli/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverUrl }),
  });
  if (!res.ok) throw new Error(`Failed to create auth session: ${res.status}`);
  return res.json();
}

export async function pollAuthSession(serverUrl, sessionId) {
  const res = await fetch(
    `${serverUrl}/api/cli/auth/poll?session_id=${encodeURIComponent(sessionId)}`
  );
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  return res.json();
}
