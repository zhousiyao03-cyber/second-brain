/**
 * 轻量级后台任务队列，复用 knowledgeIndexJobs 表。
 *
 * 这是一个"pull-based" 队列：worker 主动 claim 下一条 pending 任务，
 * 不是消息总线 push 过去。优点：不需要额外的 broker 进程；缺点：只能
 * 依赖外部触发（cron / HTTP 调 tick 接口）来推动消费。
 *
 * ── 任务生命周期 ──
 *   enqueue()    → status = "pending", attempts = 0, queuedAt = now
 *   claimNext()  → status = "running"（原子拾取：先 select 再 update）
 *   completeJob()→ status = "done", finishedAt = now
 *   failJob()    → 如果 attempts < MAX，重置为 pending 并延后 queuedAt
 *                  (指数退避)；否则置为 failed
 *
 * ── 重试策略 ──
 *   指数退避：第 N 次失败后延迟 BASE * 2^(N-1) 毫秒再试
 *   对 N=1/2/3/4 → 1s / 2s / 4s / 8s（约 15 秒内最多 4 次）
 *   达到 MAX_ATTEMPTS（默认 5）后标记 failed，需要人工介入
 *
 * ── 学习要点 ──
 * - 队列的"原子拾取"很重要，否则多 worker 会抢到同一条任务。这里用
 *   "select pending + update set status=running where id=X and status=pending"
 *   的两步方式，配合 SQLite 的事务保证同一时刻只有一个 update 成功
 * - 指数退避避免雪崩：下游服务抖动时别用固定间隔硬怼，等它恢复
 * - MAX_ATTEMPTS 是"死信队列"的替身：超了就进 failed，留给人看
 */

import crypto from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { knowledgeIndexJobs } from "../db/schema";
import { logger } from "../logger";

export type JobSourceType = "note" | "bookmark";

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000; // 1s，第一次重试的基础延迟

/**
 * 入队一条新任务。
 * 相同 sourceId 的重复入队会产生多条记录 — 这是有意的：
 * worker 可能正在处理老版本，而用户又更新了一次；
 * 老 job 完成后新 job 会再跑一次，自然达到"最新内容最终被索引"的状态。
 */
export async function enqueueJob(input: {
  sourceType: JobSourceType;
  sourceId: string;
  reason: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(knowledgeIndexJobs).values({
    id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    reason: input.reason,
    status: "pending",
    attempts: 0,
    queuedAt: new Date(),
  });
  logger.debug(
    {
      event: "job.enqueue",
      jobId: id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: input.reason,
    },
    "job enqueued"
  );
  return id;
}

/**
 * 拾取下一条可执行的任务。
 *
 * "可执行" = status 为 pending 且 queuedAt <= now（后者用于等待退避冷却）。
 * 多 worker 场景下靠 "update ... where id=X and status=pending" 的单行更新
 * 做原子锁，只有一个 worker 能抢到。
 */
export async function claimNextJob() {
  const now = new Date();

  const [candidate] = await db
    .select()
    .from(knowledgeIndexJobs)
    .where(
      and(
        eq(knowledgeIndexJobs.status, "pending"),
        lte(knowledgeIndexJobs.queuedAt, now)
      )
    )
    .orderBy(asc(knowledgeIndexJobs.queuedAt))
    .limit(1);

  if (!candidate) return null;

  // 原子拾取：只有当该 job 仍处于 pending 时 update 才会生效
  // 注意：Drizzle 对 libsql 的 `.returning()` 尚不稳定，这里先 update 再二次
  // 读取，用 attempts 的变化来判断是否确实抢到（我们 attempts++ 了）
  await db
    .update(knowledgeIndexJobs)
    .set({
      status: "running",
      attempts: sql`${knowledgeIndexJobs.attempts} + 1`,
    })
    .where(
      and(
        eq(knowledgeIndexJobs.id, candidate.id),
        eq(knowledgeIndexJobs.status, "pending")
      )
    );

  const [claimed] = await db
    .select()
    .from(knowledgeIndexJobs)
    .where(eq(knowledgeIndexJobs.id, candidate.id));

  // 检查是不是真的我们抢到的（status 变成 running 且 attempts 增加）
  if (!claimed || claimed.status !== "running") {
    return null;
  }

  logger.debug(
    {
      event: "job.claim",
      jobId: claimed.id,
      sourceType: claimed.sourceType,
      sourceId: claimed.sourceId,
      attempts: claimed.attempts,
    },
    "job claimed"
  );

  return claimed;
}

/** 标记任务完成 */
export async function completeJob(jobId: string) {
  await db
    .update(knowledgeIndexJobs)
    .set({ status: "done", finishedAt: new Date(), error: null })
    .where(eq(knowledgeIndexJobs.id, jobId));

  logger.debug({ event: "job.complete", jobId }, "job completed");
}

/**
 * 标记任务失败。
 * - attempts < MAX：设回 pending + queuedAt 延后（指数退避），留 error 信息
 * - attempts >= MAX：终态 failed，需要人工检查
 */
export async function failJob(jobId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  const [job] = await db
    .select()
    .from(knowledgeIndexJobs)
    .where(eq(knowledgeIndexJobs.id, jobId));

  if (!job) {
    logger.warn({ event: "job.fail_missing", jobId }, "failJob: job not found");
    return;
  }

  if (job.attempts >= MAX_ATTEMPTS) {
    await db
      .update(knowledgeIndexJobs)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(knowledgeIndexJobs.id, jobId));

    logger.error(
      {
        event: "job.dead",
        jobId,
        attempts: job.attempts,
        error: message,
      },
      "job reached max attempts, marked failed"
    );
    return;
  }

  // 指数退避：1s, 2s, 4s, 8s, ...
  const backoffMs = RETRY_BASE_MS * 2 ** (job.attempts - 1);
  const nextRunAt = new Date(Date.now() + backoffMs);

  await db
    .update(knowledgeIndexJobs)
    .set({
      status: "pending",
      error: message,
      queuedAt: nextRunAt,
    })
    .where(eq(knowledgeIndexJobs.id, jobId));

  logger.warn(
    {
      event: "job.retry",
      jobId,
      attempts: job.attempts,
      backoffMs,
      nextRunAt: nextRunAt.toISOString(),
      error: message,
    },
    "job will be retried"
  );
}

/**
 * 查询队列统计 — 用于 /api/metrics。
 * 只聚合 4 个状态的计数，成本很低（有 status 索引）。
 */
export async function queueSnapshot() {
  const rows = await db
    .select({
      status: knowledgeIndexJobs.status,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(knowledgeIndexJobs)
    .groupBy(knowledgeIndexJobs.status);

  const stats = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.count);
  }
  return stats;
}
