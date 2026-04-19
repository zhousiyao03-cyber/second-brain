/**
 * Redis 版缓存封装，接口和 NamedCache 保持一致（可直接替换）。
 *
 * ── 和内存版 NamedCache 的关键差异 ──
 *
 * 1. **跨实例共享**
 *    单机自托管、多副本容器或 serverless 场景里的进程内内存都彼此隔离。
 *    Redis 让所有实例共享同一份缓存，命中率可以接近理论上限。
 *
 * 2. **序列化**
 *    Redis 只存字符串，所以所有值都要 JSON.stringify/parse。
 *    代价：循环引用、undefined、Date 对象需要特殊处理（JSON 会把 Date
 *    变成 ISO 字符串，反序列化后变字符串而不是 Date 实例）。
 *
 * 3. **key 命名空间**
 *    所有 key 都加上 `sb:{cacheName}:` 前缀，防止不同 cache 互相污染、
 *    也方便用 `SCAN` 批量清理（比如改 schema 时一键失效整个命名空间）。
 *
 * 4. **TTL 用 Redis 原生 EX 选项**
 *    `SET key value EX 30` — Redis 会自动过期，不需要应用层管。
 *
 * 5. **失败降级**
 *    Redis 网络抖动 / 未配置时，getOrLoad 直接调 loader 走数据源，
 *    保证可用性。代价：此时没有缓存加速，p95 会退化到 DB 原始耗时。
 *
 * 6. **read-through 模式**
 *    这是最常见的缓存模式：读时先查 cache，miss 就查 DB 并回填。
 *    写时由调用方显式 invalidate。
 */

import { getRedis } from "../redis";
import { logger } from "../logger";
import { recordCacheEvent } from "../metrics";

export type RedisCacheOptions = {
  /** 命名空间，用于 key 前缀 + metrics 聚合 */
  name: string;
  /** 条目存活时间（秒）。默认 30 秒。 */
  ttlSeconds?: number;
};

export class RedisCache<T> {
  readonly name: string;
  private readonly ttlSeconds: number;
  private testClient: Awaited<ReturnType<typeof getRedis>> | null | undefined;

  constructor({ name, ttlSeconds = 30 }: RedisCacheOptions) {
    this.name = name;
    this.ttlSeconds = ttlSeconds;
  }

  private key(rawKey: string) {
    return `sb:${this.name}:${rawKey}`;
  }

  private async getClient() {
    if (this.testClient !== undefined) {
      return this.testClient;
    }

    return getRedis();
  }

  /** Test-only hook so unit tests can inject a fake Redis client. */
  __setTestClientForUnitTest(
    client: Awaited<ReturnType<typeof getRedis>> | null
  ) {
    this.testClient = client;
  }

  /**
   * 读缓存，未命中时调用 loader 并回填。
   * 返回类型从 loader 推断。
   */
  async getOrLoad<R extends T>(rawKey: string, loader: () => Promise<R>): Promise<R> {
    const client = await this.getClient();
    const fullKey = this.key(rawKey);

    // Redis 不可用 — 降级为直接走数据源，不做缓存
    if (!client) {
      const value = await loader();
      return value;
    }

    try {
      const cached = await client.get(fullKey);
      if (cached !== null) {
        recordCacheEvent({ name: this.name, event: "hit" });
        logger.debug(
          { event: "cache.hit", cache: this.name, key: rawKey },
          "cache hit"
        );
        return JSON.parse(cached) as R;
      }

      recordCacheEvent({ name: this.name, event: "miss" });
      logger.debug(
        { event: "cache.miss", cache: this.name, key: rawKey },
        "cache miss"
      );

      const value = await loader();
      // EX 秒级 TTL；NX 不加是因为我们就是想覆盖写
      await client.set(fullKey, JSON.stringify(value), { expiration: { type: "EX", value: this.ttlSeconds } });
      return value;
    } catch (err) {
      // Redis 操作失败 → 直接走数据源，保证可用性
      logger.error(
        { event: "cache.error", cache: this.name, key: rawKey, err },
        "cache operation failed, falling back to loader"
      );
      return loader();
    }
  }

  /** 失效单个 key */
  async invalidate(rawKey: string) {
    const client = await this.getClient();
    if (!client) return;

    try {
      const deleted = await client.del(this.key(rawKey));
      if (deleted > 0) {
        recordCacheEvent({ name: this.name, event: "invalidate" });
        logger.debug(
          { event: "cache.invalidate", cache: this.name, key: rawKey },
          "cache invalidated"
        );
      }
    } catch (err) {
      logger.error(
        { event: "cache.invalidate_error", cache: this.name, key: rawKey, err },
        "cache invalidate failed"
      );
    }
  }

  /**
   * 清空这个命名空间下的所有 key。
   * 用 SCAN 而不是 KEYS —— KEYS 会阻塞 Redis 主线程，生产环境禁用。
   */
  async clear() {
    const client = await this.getClient();
    if (!client) return;

    try {
      const pattern = `sb:${this.name}:*`;
      let cursor = "0";
      let totalDeleted = 0;
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          totalDeleted += await client.del(result.keys);
        }
      } while (cursor !== "0");

      if (totalDeleted > 0) {
        recordCacheEvent({ name: this.name, event: "clear" });
        logger.debug(
          { event: "cache.clear", cache: this.name, deleted: totalDeleted },
          "cache cleared"
        );
      }
    } catch (err) {
      logger.error(
        { event: "cache.clear_error", cache: this.name, err },
        "cache clear failed"
      );
    }
  }

  /** Delete every key that starts with the provided raw-key prefix. */
  async invalidateWhere(rawKeyPrefix: string) {
    const client = await this.getClient();
    if (!client) return;

    try {
      const pattern = `${this.key(rawKeyPrefix)}*`;
      let cursor = "0";
      let totalDeleted = 0;

      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          totalDeleted += await client.del(result.keys);
        }
      } while (cursor !== "0");

      if (totalDeleted > 0) {
        recordCacheEvent({ name: this.name, event: "clear" });
        logger.debug(
          {
            event: "cache.invalidate_prefix",
            cache: this.name,
            rawKeyPrefix,
            deleted: totalDeleted,
          },
          "cache prefix invalidated"
        );
      }
    } catch (err) {
      logger.error(
        { event: "cache.invalidate_prefix_error", cache: this.name, rawKeyPrefix, err },
        "cache prefix invalidate failed"
      );
    }
  }
}
