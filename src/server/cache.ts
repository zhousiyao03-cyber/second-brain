/**
 * 内存缓存封装（基于 lru-cache）
 *
 * 设计要点：
 * - 每个 cache 是独立的命名空间（name），方便按维度失效和监控
 * - LRU + TTL：容量满了踢掉最老的，过了 TTL 自动过期
 * - write-through 失效：写操作完成后主动调用 invalidate，避免脏数据
 * - 命中/未命中计数累加到全局 metrics，便于观察缓存效果
 *
 * 学习要点：
 * - 内存缓存只在"单进程"范围内有效，多实例部署需要换成 Redis 这种外部存储
 * - 缓存 key 的设计很重要：必须包含所有会影响结果的参数（这里通常是 userId）
 * - TTL 是缓存一致性的安全网：即使 invalidate 被漏掉，最多也就脏 TTL 秒
 */

import { LRUCache } from "lru-cache";
import { logger } from "./logger";
import { recordCacheEvent } from "./metrics";

export type CacheOptions = {
  /** 命名空间，用于日志和 metrics */
  name: string;
  /** 最大条目数 */
  max?: number;
  /** 条目存活时间（毫秒） */
  ttlMs?: number;
};

export class NamedCache<T extends NonNullable<unknown>> {
  readonly name: string;
  private readonly store: LRUCache<string, T>;

  constructor({ name, max = 500, ttlMs = 30_000 }: CacheOptions) {
    this.name = name;
    this.store = new LRUCache<string, T>({
      max,
      ttl: ttlMs,
    });
  }

  /**
   * 读缓存，未命中时调用 loader 并回填。
   * 等价于 "read-through" 模式：调用方不需要关心缓存存不存在。
   * 返回类型从 loader 推断，避免调用方把每个类型都硬标注一遍。
   */
  async getOrLoad<R extends T>(key: string, loader: () => Promise<R>): Promise<R> {
    const cached = this.store.get(key);
    if (cached !== undefined) {
      recordCacheEvent({ name: this.name, event: "hit" });
      logger.debug({ event: "cache.hit", cache: this.name, key }, "cache hit");
      return cached as R;
    }

    recordCacheEvent({ name: this.name, event: "miss" });
    logger.debug({ event: "cache.miss", cache: this.name, key }, "cache miss");
    const value = await loader();
    this.store.set(key, value);
    return value;
  }

  /** 显式写入（很少直接用，通常靠 getOrLoad 回填） */
  set(key: string, value: T) {
    this.store.set(key, value);
  }

  /** 失效单个 key */
  invalidate(key: string) {
    const existed = this.store.delete(key);
    if (existed) {
      recordCacheEvent({ name: this.name, event: "invalidate" });
      logger.debug({ event: "cache.invalidate", cache: this.name, key }, "cache invalidated");
    }
  }

  /** 失效所有 key — 谨慎使用 */
  clear() {
    this.store.clear();
    recordCacheEvent({ name: this.name, event: "clear" });
    logger.debug({ event: "cache.clear", cache: this.name }, "cache cleared");
  }

  /** 当前大小，供 metrics 端点读取 */
  size() {
    return this.store.size;
  }
}
