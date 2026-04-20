import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/lib/auth";
import { getEntitlements } from "./billing/entitlements";
import { logger, newRequestId } from "./logger";
import { recordProcedureCall } from "./metrics";

const t = initTRPC.create({
  transformer: superjson,
});

/**
 * 把 TRPCError 的 code 归类成 client_error / server_error。
 * 学习要点：可观测性里的一个核心原则是区分"用户错误"和"系统错误"，
 * 前者不该告警（用户输错了参数不是 bug），后者应该立刻告警。
 */
const CLIENT_ERROR_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
  "METHOD_NOT_SUPPORTED",
]);

function classifyError(err: unknown): "client_error" | "server_error" {
  if (err instanceof TRPCError && CLIENT_ERROR_CODES.has(err.code)) {
    return "client_error";
  }
  return "server_error";
}

/**
 * 日志 + 指标 middleware。
 * 每个 procedure 调用都会记录：
 *   - requestId / procedure / type / durationMs / status
 *   - userId（如果能拿到）
 *   - err（如果失败）
 *
 * client_error（用户错误）记 warn；server_error（系统异常）记 error。
 */
/**
 * loggingMiddleware 位于最外层，在 authMiddleware 之前运行。
 * 因此在 protectedProcedure 场景下，logging 这一层看不到 userId
 * （此时 next() 返回后的 ctx 对外层 middleware 不可见）。
 *
 * 对于需要 userId 维度聚合的场景，应由上层（例如请求日志中间件）
 * 通过请求 session 直接读取，而不是依赖这里的 middleware 链。
 */
const loggingMiddleware = t.middleware(async ({ path, type, next }) => {
  const requestId = newRequestId();
  const start = performance.now();
  const log = logger.child({ requestId, procedure: path, type });

  try {
    const result = await next();
    const durationMs = Math.round(performance.now() - start);

    if (result.ok) {
      log.debug({ event: "trpc.call", durationMs, status: "success" }, "procedure ok");
      recordProcedureCall({ procedure: path, durationMs, status: "success" });
    } else {
      const status = classifyError(result.error);
      const logLevel = status === "server_error" ? "error" : "warn";
      log[logLevel](
        { event: "trpc.call", durationMs, status, err: result.error },
        "procedure failed"
      );
      recordProcedureCall({ procedure: path, durationMs, status });
    }

    return result;
  } catch (err) {
    // next() 理论上不会抛 — tRPC 会把错误放在 result.error 里；
    // 但为了以防万一，这里兜底处理一次
    const durationMs = Math.round(performance.now() - start);
    const status = classifyError(err);
    log.error({ event: "trpc.call", durationMs, status, err }, "procedure threw");
    recordProcedureCall({ procedure: path, durationMs, status });
    throw err;
  }
});

const authMiddleware = t.middleware(async ({ next }) => {
  // Allow bypass for E2E testing
  if (process.env.AUTH_BYPASS === "true") {
    return next({ ctx: { userId: process.env.AUTH_BYPASS_USER_ID ?? "test-user" } });
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { userId: session.user.id } });
});

/**
 * entitlementsMiddleware 挂在 authMiddleware 之后，把订阅派生的
 * entitlements 注入到 ctx。自托管模式下恒定返回 PRO_UNLIMITED；
 * hosted 模式下走 Redis 缓存的 getEntitlements()。
 *
 * 若上游没有 userId（例如有人错误地把它挂在 publicProcedure 上），
 * 这里直接透传，不会抛错，保持中间件可复用。
 */
const entitlementsMiddleware = t.middleware(async ({ ctx, next }) => {
  const userId = (ctx as { userId?: string }).userId;
  if (!userId) return next();
  const entitlements = await getEntitlements(userId);
  return next({ ctx: { ...ctx, entitlements } });
});

/**
 * requireProMiddleware 要求当前用户 plan === "pro"，否则抛 FORBIDDEN。
 * message 用 JSON 编码，便于客户端稳定解析 reason 做 upsell。
 */
const requireProMiddleware = t.middleware(async ({ ctx, next }) => {
  const ent = (ctx as { entitlements?: { plan: string } }).entitlements;
  if (!ent || ent.plan !== "pro") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: JSON.stringify({ reason: "PRO_REQUIRED" }),
    });
  }
  return next();
});

export const router = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);
export const protectedProcedure = t.procedure
  .use(loggingMiddleware)
  .use(authMiddleware)
  .use(entitlementsMiddleware);
export const proProcedure = protectedProcedure.use(requireProMiddleware);
