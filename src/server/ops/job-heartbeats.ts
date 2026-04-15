import { db } from "@/server/db";
import { opsJobHeartbeats } from "@/server/db/schema";
import type { OpsJobHeartbeatSnapshot } from "./types";

export async function markOpsJobSuccess(jobName: string, message: string | null = null) {
  const now = new Date();
  await db
    .insert(opsJobHeartbeats)
    .values({
      jobName,
      lastStatus: "healthy",
      lastSuccessAt: now,
      lastMessage: message,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opsJobHeartbeats.jobName,
      set: {
        lastStatus: "healthy",
        lastSuccessAt: now,
        lastMessage: message,
        updatedAt: now,
      },
    });
}

export async function markOpsJobFailure(jobName: string, message: string) {
  const now = new Date();
  await db
    .insert(opsJobHeartbeats)
    .values({
      jobName,
      lastStatus: "degraded",
      lastFailureAt: now,
      lastMessage: message,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opsJobHeartbeats.jobName,
      set: {
        lastStatus: "degraded",
        lastFailureAt: now,
        lastMessage: message,
        updatedAt: now,
      },
    });
}

export function normalizeJobHeartbeat(
  rows: Array<{
    jobName: string;
    lastStatus: "healthy" | "degraded";
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    lastMessage: string | null;
  }>,
  jobName: string
): OpsJobHeartbeatSnapshot {
  const row = rows.find((item) => item.jobName === jobName);
  if (!row) {
    return {
      jobName,
      status: "unknown",
      lastSuccessAt: null,
      lastFailureAt: null,
      message: null,
    };
  }

  return {
    jobName,
    status: row.lastStatus,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    message: row.lastMessage,
  };
}

export async function listOpsJobHeartbeats() {
  return db.select().from(opsJobHeartbeats);
}
