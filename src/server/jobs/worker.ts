/**
 * 队列 worker 驱动层。
 *
 * 暴露两个高层 API：
 *   - processOneJob()  — 拾取一条 pending job 并执行，返回执行结果
 *   - processJobs(max) — 连续处理多条 job，直到没活或达到 max，
 *                        用于 cron / tick 接口一次消费一小批
 *
 * worker 的职责很窄：
 *   1. 调 claimNextJob 拿到 running job
 *   2. 按 sourceType dispatch 到具体的 job handler（目前只有 index）
 *   3. 成功 → completeJob；失败 → failJob（触发重试逻辑）
 *   4. 所有异常都在这里被吞掉，不让一条烂 job 把整个 tick 搞挂
 *
 * ── 为什么不在进程内起 setInterval？──
 * Next.js 在 Vercel 这种 serverless 场景下，函数实例生命周期短且
 * 不可预测，常驻 setInterval 会丢。用"外部触发 tick 接口"的模式
 * 更稳：cron 或前端心跳定时敲一下即可。
 */

import { logger } from "../logger";
import { claimNextJob, completeJob, failJob, reclaimStaleJobs } from "./queue";
import { runIndexJobFor } from "../ai/indexer";
import type { JobSourceType } from "./queue";

export type ProcessResult =
  | { processed: false; reason: "no_jobs" }
  | { processed: true; jobId: string; status: "done" | "failed" | "retry" };

/** 执行单条任务。返回 null 表示队列空了。 */
export async function processOneJob(): Promise<ProcessResult> {
  const job = await claimNextJob();
  if (!job) return { processed: false, reason: "no_jobs" };

  const start = performance.now();
  try {
    await dispatch(job.sourceType, job.sourceId, job.reason ?? "job-run");
    await completeJob(job.id);

    logger.info(
      {
        event: "job.done",
        jobId: job.id,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        attempts: job.attempts,
        durationMs: Math.round(performance.now() - start),
      },
      "job processed"
    );
    return { processed: true, jobId: job.id, status: "done" };
  } catch (err) {
    await failJob(job.id, err);
    return {
      processed: true,
      jobId: job.id,
      // failJob 内部根据 attempts 决定是否进终态 failed，这里返回 retry
      // 语义是"这次没成，可能会再跑"。
      status: "retry",
    };
  }
}

/**
 * 连续处理最多 max 条任务。
 * 适合 cron 或手动 tick：一次消费掉一小批，避免长时间占用请求。
 */
export async function processJobs(max = 10) {
  // 每次 tick 先回收卡死超过 10 分钟的 running jobs
  await reclaimStaleJobs(10);

  let processed = 0;
  let errors = 0;
  for (let i = 0; i < max; i++) {
    const result = await processOneJob();
    if (!result.processed) break;
    processed += 1;
    if (result.status !== "done") errors += 1;
  }
  return { processed, errors };
}

/** 路由 job 到具体的 handler */
async function dispatch(sourceType: JobSourceType, sourceId: string, reason: string) {
  if (sourceType === "note" || sourceType === "bookmark") {
    await runIndexJobFor(sourceType, sourceId, reason);
    return;
  }
  throw new Error(`Unknown job sourceType: ${sourceType}`);
}
