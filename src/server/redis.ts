/**
 * Redis client 单例封装（基于 node-redis v5）。
 *
 * 设计要点：
 *
 * 1. **Lazy + Promise singleton**
 *    第一次调用 getRedis() 时才建立连接，之后复用同一个 promise。
 *    在 Next.js / Vercel Serverless 场景下这很关键：
 *    - 每个 function 实例第一次调用时连一次，后续请求复用
 *    - 模块热更新（HMR）时不会重复连接（dev 环境下挂在 global 上）
 *
 * 2. **优雅降级**
 *    如果 REDIS_URL 没配（本地 dev 没拉 env、CI 环境），getRedis() 返回 null。
 *    调用方（RedisCache）据此 fallback 到内存缓存或直接走数据源，
 *    不会因为 Redis 不可用就让整个应用挂掉。
 *
 * 3. **环境变量优先级**
 *    - REDIS_URL（Vercel 示例的标准命名）
 *    - second_brain_REDIS_URL（你 Vercel 项目里自定义注入的名字）
 *    前者优先；都没有就返回 null。
 *
 * 4. **连接错误不抛**
 *    Redis 连接失败时打一条 error 日志，getRedis() 返回 null，
 *    下次调用会重新尝试连接。这样一次网络抖动不会"毒化"后续请求。
 */

import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger";

type RedisPromise = Promise<RedisClientType | null>;

// 在 dev 模式下把 client promise 挂在 globalThis 上，避免 HMR 反复建连接
declare global {
  // eslint-disable-next-line no-var
  var __redisClientPromise: RedisPromise | undefined;
}

function resolveRedisUrl(): string | null {
  return (
    process.env.REDIS_URL ??
    process.env.second_brain_REDIS_URL ??
    null
  );
}

async function connect(): Promise<RedisClientType | null> {
  const url = resolveRedisUrl();
  if (!url) {
    logger.warn(
      { event: "redis.missing_url" },
      "REDIS_URL not set — redis features disabled"
    );
    return null;
  }

  try {
    const client = createClient({ url }) as RedisClientType;

    // node-redis v5: error 事件必须 handle，否则 unhandled rejection
    client.on("error", (err) => {
      logger.error({ event: "redis.error", err }, "redis client error");
    });

    await client.connect();
    logger.info({ event: "redis.connected" }, "redis connected");
    return client;
  } catch (err) {
    logger.error({ event: "redis.connect_failed", err }, "redis connect failed");
    // 清掉缓存的 promise，让下次调用重新尝试
    globalThis.__redisClientPromise = undefined;
    return null;
  }
}

/**
 * 获取共享的 Redis client。第一次调用会建立连接，之后复用。
 * 如果 REDIS_URL 没配或连接失败，返回 null — 调用方需要处理这种情况。
 */
export function getRedis(): RedisPromise {
  if (!globalThis.__redisClientPromise) {
    globalThis.__redisClientPromise = connect();
  }
  return globalThis.__redisClientPromise;
}

/** 判断 Redis 是否可用（非阻塞快速检查） */
export function isRedisConfigured(): boolean {
  return resolveRedisUrl() !== null;
}
