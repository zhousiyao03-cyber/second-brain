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
import { processJobs } from "@/server/jobs/worker";

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const maxParam = url.searchParams.get("max");
  const max = maxParam ? Math.max(1, Math.min(100, Number(maxParam))) : 10;

  const result = await processJobs(max);
  return NextResponse.json(result);
}

async function isAuthorized(request: Request): Promise<boolean> {
  if (process.env.AUTH_BYPASS === "true") return true;

  const token = process.env.JOBS_TICK_TOKEN;
  if (token) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${token}`) return true;
  }

  const session = await auth();
  return !!session?.user?.id;
}
