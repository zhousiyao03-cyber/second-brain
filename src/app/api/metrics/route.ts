/**
 * GET /api/metrics
 *
 * 返回当前进程内 tRPC procedure 调用的统计信息（总次数 / 错误率 / p50/p95/p99）
 * 以及缓存命中率。
 *
 * 这是一个纯本地观察工具 — 进程重启就清零，也不做认证之外的保护。
 * 仅对登录用户开放，避免 path 枚举信息泄漏。
 *
 * HTTP 缓存演示：
 * - `Cache-Control: private, max-age=5` — 浏览器最多复用 5 秒
 * - `ETag` — 基于响应内容 hash 生成，配合 `If-None-Match` 实现 304
 *
 * 学习要点：
 * - `private` 表示这个响应是用户相关的，CDN 等共享缓存不能缓存它
 * - `max-age=5` 让浏览器可以直接用本地缓存，不发请求
 * - ETag 是更精确的"内容变没变"检查，即使 max-age 过期，浏览器
 *   也会带 If-None-Match 请求一次，内容没变服务器就返回 304
 *   (不带 body)，节省带宽
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { isAuthBypassEnabled } from "@/server/auth/request-session";
import { snapshotMetrics } from "@/server/metrics";
import { queueSnapshot } from "@/server/jobs/queue";

function computeEtag(body: string) {
  const hash = createHash("sha1").update(body).digest("base64url");
  return `W/"${hash}"`; // weak ETag — 表示字节级可能不同但语义相同就算匹配
}

export async function GET(request: Request) {
  if (!isAuthBypassEnabled()) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const baseSnapshot = snapshotMetrics();
  const jobs = await queueSnapshot();
  const snapshot = { ...baseSnapshot, jobs };
  const body = JSON.stringify(snapshot);
  // ETag 基于"内容"而不是"时间戳" —— 否则每次请求 generatedAt 变了，
  // 304 就永远命中不了。这里取除 generatedAt 之外的部分做 hash。
  const { generatedAt: _ignored, ...stableSnapshot } = snapshot;
  void _ignored;
  const etag = computeEtag(JSON.stringify(stableSnapshot));

  // 如果 client 带了匹配的 If-None-Match，直接返回 304 Not Modified
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=5",
      },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ETag: etag,
      "Cache-Control": "private, max-age=5",
    },
  });
}
