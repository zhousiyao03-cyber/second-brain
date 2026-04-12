import crypto from "node:crypto";

interface PendingSession {
  createdAt: number;
  token: string | null;
}

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map<string, PendingSession>();

export function createCliAuthSession(): string {
  cleanup();
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, { createdAt: Date.now(), token: null });
  return sessionId;
}

export function getCliAuthSessionStatus(sessionId: string): "pending" | string | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  if (session.token) {
    sessions.delete(sessionId);
    return session.token;
  }
  return "pending";
}

export function approveCliAuthSession(sessionId: string, token: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return false;
  }
  if (session.token) return false;
  session.token = token;
  return true;
}

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}
