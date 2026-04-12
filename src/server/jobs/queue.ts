/**
 * 轻量级后台任务队列，复用 knowledgeIndexJobs 表。
 *
 * 这是一个 "pull-based" 队列：worker 主动 claim 下一条 pending 任务，
 * 不是消息总线 push 过去。优点：不需要额外的 broker 进程；缺点：只能
 * 依赖外部触发（cron / HTTP 调 tick 接口）来推动消费。
 *
 * ── 业务定位 ──
 * Second Brain 的 "笔记/书签 → RAG 索引" 后台重建管道的入队/出队层。
 * notes.ts 在用户保存笔记时 fire-and-forget 入队，worker.ts 被 cron
 * 或 /api/jobs tick 端点驱动，最终交给 ai/indexer.ts 做 chunk + embed
 * + 写入 knowledgeChunks。设计与实验见 docs/learn-backend/phase-b1.md。
 *
 * ── 任务生命周期 ──
 *   enqueue()    → status = "pending", attempts = 0, queuedAt = now
 *   claimNext()  → status = "running"（一条 UPDATE ... RETURNING 原子完成）
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
 * - 原子拾取的关键不是 "SELECT + UPDATE 两步"，而是 UPDATE 的 WHERE
 *   子句里包含一个会被其他 worker 改掉的字段（status='pending'），
 *   起到 compare-and-swap 的作用。B1-2 实验证明：去掉这个 WHERE
 *   守卫会出现 32/32 double-claim，保留了就能天然互斥。
 * - 为了让代码层面的原子性更显然，这里用 "UPDATE ... WHERE id=
 *   (SELECT ... LIMIT 1) RETURNING" 压成一条 SQL，消除两步之间的窗口。
 * - 指数退避避免雪崩：下游服务抖动时别用固定间隔硬怼，等它恢复
 * - MAX_ATTEMPTS 是"死信队列"的替身：超了就进 failed，留给人看
 * - enqueueJob 支持传入 tx，让调用方能把入队和业务写放进同一个 DB
 *   事务（outbox 雏形）——参见 notes.update。
 */

import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, dbClient } from "../db";
import { knowledgeIndexJobs } from "../db/schema";
import { logger } from "../logger";

/**
 * 可接受 db 或事务 tx 的 runner 类型。
 * Drizzle 的 tx 在结构上兼容 db —— 共用 insert/select/update/run 方法，
 * 所以这里只抽取 enqueueJob 真正用到的子集作为参数类型，既满足调用方
 * 传 db 的老用法，也允许 notes.update 这样的事务里把入队放进同一个
 * tx，形成一个最小的 outbox 雏形。
 */
type DbRunner = Pick<typeof db, "insert">;

export type JobSourceType = "note" | "bookmark";

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000; // 1s，第一次重试的基础延迟

/**
 * 入队一条新任务。
 * 相同 sourceId 的重复入队会产生多条记录 — 这是有意的：
 * worker 可能正在处理老版本，而用户又更新了一次；
 * 老 job 完成后新 job 会再跑一次，自然达到"最新内容最终被索引"的状态。
 *
 * @param runner 可选。默认用模块级 db；调用方如果在 db.transaction 里
 *   想让入队跟随事务（outbox 雏形），把 tx 传进来即可。
 */
export async function enqueueJob(
  input: {
    sourceType: JobSourceType;
    sourceId: string;
    reason: string;
  },
  runner: DbRunner = db
) {
  const id = crypto.randomUUID();
  await runner.insert(knowledgeIndexJobs).values({
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
 *
 * 实现：一条 "UPDATE ... WHERE id=(SELECT ... LIMIT 1 WHERE status='pending'
 * AND queued_at <= now ORDER BY queued_at ASC) RETURNING *"。
 * 把 "挑一条最早的 pending" 和 "标记 running + attempts++" 压在一条 SQL
 * 里，彻底消除两步之间的 race 窗口。多 worker 并发下只有一个 UPDATE
 * 能命中匹配行，其余的子查询 LIMIT 1 返回空集 → 没有 row 被影响 →
 * RETURNING 空 → 本次判空返回 null。
 *
 * 设计决策参见 docs/learn-backend/phase-b1.md（B1-2 实验 + B1-1 重构）。
 *
 * 另：这里走 dbClient.execute 直接发 SQL，而不是 Drizzle 的链式 API。
 * 原因是我们需要子查询 + RETURNING 的组合，Drizzle 对 libsql 的
 * .returning() 支持已经稳定（B1-2 脚本里验证过），但 "UPDATE WHERE
 * id IN (SELECT ... ORDER BY ... LIMIT 1)" 这种形式用链式 API 组装
 * 反而比原始 SQL 啰嗦、更难读。
 */
export async function claimNextJob() {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const result = await dbClient.execute({
    sql: `
      UPDATE knowledge_index_jobs
      SET status = 'running', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM knowledge_index_jobs
        WHERE status = 'pending' AND queued_at <= ?
        ORDER BY queued_at ASC
        LIMIT 1
      )
      RETURNING id, source_type, source_id, reason, status, error, attempts, queued_at, finished_at
    `,
    args: [nowSeconds],
  });

  const row = result.rows[0];
  if (!row) return null;

  const claimed = {
    id: String(row.id),
    sourceType: row.source_type as JobSourceType,
    sourceId: String(row.source_id),
    reason: row.reason == null ? null : String(row.reason),
    status: row.status as "pending" | "running" | "done" | "failed",
    error: row.error == null ? null : String(row.error),
    attempts: Number(row.attempts),
    queuedAt:
      row.queued_at == null ? null : new Date(Number(row.queued_at) * 1000),
    finishedAt:
      row.finished_at == null
        ? null
        : new Date(Number(row.finished_at) * 1000),
  };

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
 * 回收卡死的 running jobs。
 *
 * Vercel function 可能因超时/崩溃导致 job 被 claim 后永远停在 running。
 * 把超过 staleMinutes 的 running job 重置为 pending，让 worker 重新拾取。
 */
export async function reclaimStaleJobs(staleMinutes = 10) {
  const cutoff = Math.floor(Date.now() / 1000) - staleMinutes * 60;

  const result = await dbClient.execute({
    sql: `
      UPDATE knowledge_index_jobs
      SET status = 'pending',
          error = 'reclaimed: stale running job'
      WHERE status = 'running'
        AND queued_at <= ?
      RETURNING id
    `,
    args: [cutoff],
  });

  if (result.rows.length > 0) {
    logger.warn(
      {
        event: "job.reclaim_stale",
        count: result.rows.length,
        cutoffMinutes: staleMinutes,
      },
      `reclaimed ${result.rows.length} stale running jobs`
    );
  }

  return result.rows.length;
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
