/**
 * POST /api/jobs/tick
 *
 * 外部驱动队列消费的入口。可由以下方式触发：
 *   - 手动 curl（开发时）
 *   - cron 定时任务（生产）
 *   - 前端低频心跳（用户在线时）
 *
 * Query params:
 *   ?max=N  最多处理多少条（默认 10）
 *
 * 返回：{ processed: number, errors: number }
 *
 * 保护：需要登录 OR 带上 JOBS_TICK_TOKEN。cron 和手动 curl 用 token，
 * 网页触发用 session。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAuthBypassEnabled } from "@/server/auth/request-session";
import { processJobs } from "@/server/jobs/worker";
import { markOpsJobFailure, markOpsJobSuccess } from "@/server/ops/job-heartbeats";

async function handle(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const maxParam = url.searchParams.get("max");
  const max = maxParam ? Math.max(1, Math.min(100, Number(maxParam))) : 10;

  try {
    const result = await processJobs(max);
    await markOpsJobSuccess("jobs-tick", `processed=${result.processed}, errors=${result.errors}`);
    return NextResponse.json(result);
  } catch (error) {
    await markOpsJobFailure(
      "jobs-tick",
      error instanceof Error ? error.message : "unknown error"
    );
    throw error;
  }
}

export const GET = handle;
export const POST = handle;

async function isAuthorized(request: Request): Promise<boolean> {
  if (isAuthBypassEnabled()) return true;

  const header = request.headers.get("authorization");

  // 保留对 CRON_SECRET 的 Bearer 鉴权，兼容外部 cron 调度器。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && header === `Bearer ${cronSecret}`) return true;

  const token = process.env.JOBS_TICK_TOKEN;
  if (token && header === `Bearer ${token}`) return true;

  const session = await auth();
  return !!session?.user?.id;
}
