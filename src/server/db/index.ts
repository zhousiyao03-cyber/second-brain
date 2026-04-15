import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getDatabaseUrl } from "./path";
import * as schema from "./schema";
import { logger } from "../logger";
import { recordOperationalEvent } from "../metrics";

const databaseUrl = getDatabaseUrl();

const rawClient = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * 慢查询日志 wrapper。
 *
 * 实现方式：在不改动 libsql client 形状的前提下，拦截其 `execute` / `batch`
 * 方法，测出真实耗时，超过 SLOW_QUERY_THRESHOLD_MS 就 warn。
 *
 * 学习要点：
 * - 慢查询阈值是经验值，默认 100ms 是生产级 OLTP 常用的线，本地 dev 数据
 *   少一点可以设得更敏感
 * - 日志里只记 SQL 文本 + 参数长度，不记参数值本身（可能含敏感数据）
 * - 这里用函数包装而不是 Proxy，因为 libsql client 方法是显式枚举的
 */
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_MS ?? "100");

function previewSql(sql: string) {
  const trimmed = sql.replace(/\s+/g, " ").trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

/**
 * 用 Proxy 包装 execute，拦截两种重载：
 *   client.execute(stmt: InStatement)
 *   client.execute(sql: string, args?: InArgs)
 * 保留原方法的类型签名，不做任何运行时强转。
 */
function extractSqlText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "sql" in first) {
    return String((first as { sql: unknown }).sql ?? "");
  }
  return "<unknown>";
}

function extractArgCount(args: unknown[]): number {
  // (stmt object) 重载 — 参数在 stmt.args
  const first = args[0];
  if (first && typeof first === "object" && "args" in first) {
    const a = (first as { args?: unknown }).args;
    if (Array.isArray(a)) return a.length;
    if (a && typeof a === "object") return Object.keys(a).length;
    return 0;
  }
  // (sql, args?) 重载 — 参数在第二个位置
  const second = args[1];
  if (Array.isArray(second)) return second.length;
  if (second && typeof second === "object") return Object.keys(second).length;
  return 0;
}

rawClient.execute = new Proxy(rawClient.execute, {
  apply(target, thisArg, argArray) {
    const start = performance.now();
    const promise = Reflect.apply(target, thisArg, argArray) as Promise<unknown>;
    return promise
      .then((result) => {
        const durationMs = performance.now() - start;
        if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
          recordOperationalEvent("db_slow_query");
          logger.warn(
            {
              event: "db.slow_query",
              durationMs: Math.round(durationMs),
              sql: previewSql(extractSqlText(argArray)),
              argCount: extractArgCount(argArray),
            },
            "slow query"
          );
        }
        return result;
      })
      .catch((err) => {
        const durationMs = Math.round(performance.now() - start);
        recordOperationalEvent("app_error");
        logger.error(
          {
            event: "db.error",
            durationMs,
            sql: previewSql(extractSqlText(argArray)),
            err,
          },
          "db query failed"
        );
        throw err;
      });
  },
}) as typeof rawClient.execute;

export const db = drizzle(rawClient, { schema });
export const dbClient = rawClient;
