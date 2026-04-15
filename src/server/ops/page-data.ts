import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { hasTable } from "@/server/db/metadata";
import { chatTasks, daemonHeartbeats } from "@/server/db/schema";
import { snapshotMetrics } from "@/server/metrics";
import { getRedis } from "@/server/redis";
import { getDeploymentSnapshot } from "./deployment";
import { listOpsJobHeartbeats, normalizeJobHeartbeat } from "./job-heartbeats";
import { readOpsHostSnapshot } from "./host-snapshot";
import type { OpsOverallStatus, OpsServiceStatus } from "./types";

export function summarizeOverallStatus(input: {
  services: Array<{ name: string; status: OpsServiceStatus }>;
  queue: { queued: number; running: number; failedRecent: number };
  host: { available: boolean };
  cron: Record<string, { status: "healthy" | "degraded" | "unknown" }>;
}): OpsOverallStatus {
  if (!input.host.available) return "down";
  if (input.services.some((item) => item.status === "degraded")) return "degraded";
  if (Object.values(input.cron).some((item) => item.status !== "healthy")) return "degraded";
  if (input.queue.failedRecent > 0) return "degraded";
  return "healthy";
}

async function getQueueCounts() {
  const failureWindow = new Date(Date.now() - 1000 * 60 * 60 * 6);
  const [queuedRows, runningRows, failedRows, recentTasks] = await Promise.all([
    db.select({ total: count() }).from(chatTasks).where(eq(chatTasks.status, "queued")),
    db.select({ total: count() }).from(chatTasks).where(eq(chatTasks.status, "running")),
    db
      .select({ total: count() })
      .from(chatTasks)
      .where(sql`${chatTasks.status} = 'failed' and ${chatTasks.completedAt} >= ${failureWindow}`),
    db
      .select({
        id: chatTasks.id,
        taskType: chatTasks.taskType,
        status: chatTasks.status,
        activityAt: sql<Date | null>`coalesce(${chatTasks.completedAt}, ${chatTasks.startedAt}, ${chatTasks.createdAt})`,
      })
      .from(chatTasks)
      .orderBy(
        desc(sql`coalesce(${chatTasks.completedAt}, ${chatTasks.startedAt}, ${chatTasks.createdAt})`)
      )
      .limit(10),
  ]);

  return {
    queued: queuedRows[0]?.total ?? 0,
    running: runningRows[0]?.total ?? 0,
    failedRecent: failedRows[0]?.total ?? 0,
    recentTasks: recentTasks.map((task) => ({
      ...task,
      activityAt: task.activityAt?.toISOString() ?? null,
    })),
  };
}

async function getDaemonStatus() {
  const daemonTableAvailable = await hasTable("daemon_heartbeats");
  if (!daemonTableAvailable) {
    return {
      status: "unknown" as const,
      lastSeenAt: null,
    };
  }

  const [row] = await db
    .select()
    .from(daemonHeartbeats)
    .where(eq(daemonHeartbeats.kind, "chat"))
    .limit(1);

  if (!row) {
    return {
      status: "degraded" as const,
      lastSeenAt: null,
    };
  }

  const staleBefore = Date.now() - 1000 * 60 * 2;
  return {
    status: row.lastSeenAt.getTime() >= staleBefore ? ("healthy" as const) : ("degraded" as const),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

async function getRedisStatus() {
  const redis = await getRedis();
  if (!redis) {
    return { status: "degraded" as const, detail: "Redis unavailable" };
  }

  try {
    const pong = await redis.ping();
    return {
      status: pong === "PONG" ? ("healthy" as const) : ("degraded" as const),
      detail: pong,
    };
  } catch (error) {
    return {
      status: "degraded" as const,
      detail: error instanceof Error ? error.message : "Redis ping failed",
    };
  }
}

export async function getOpsPageData() {
  const [queue, daemon, host, redisStatus, metrics, jobHeartbeats] = await Promise.all([
    getQueueCounts(),
    getDaemonStatus(),
    readOpsHostSnapshot(),
    getRedisStatus(),
    Promise.resolve(snapshotMetrics()),
    hasTable("ops_job_heartbeats").then((available) =>
      available ? listOpsJobHeartbeats() : []
    ),
  ]);

  const services = [
    { name: "knosi", status: "healthy" as const, detail: "App route rendered" },
    { name: "redis", status: redisStatus.status, detail: redisStatus.detail },
    {
      name: "caddy",
      status: host.available
        ? host.snapshot.services.find((item) => item.name === "caddy")?.status ?? "unknown"
        : "unknown",
      detail: host.available
        ? host.snapshot.services.find((item) => item.name === "caddy")?.detail ?? null
        : host.reason,
    },
    { name: "daemon", status: daemon.status, detail: daemon.lastSeenAt },
  ];

  const cron = {
    jobsTick: normalizeJobHeartbeat(jobHeartbeats, "jobs-tick"),
    cleanupStaleChatTasks: normalizeJobHeartbeat(jobHeartbeats, "cleanup-stale-chat-tasks"),
    portfolioNews: normalizeJobHeartbeat(jobHeartbeats, "portfolio-news"),
  };

  return {
    generatedAt: new Date().toISOString(),
    deployment: getDeploymentSnapshot(),
    services,
    queue,
    daemon,
    metrics,
    host,
    cron,
    overallStatus: summarizeOverallStatus({
      services,
      queue,
      host,
      cron,
    }),
  };
}
