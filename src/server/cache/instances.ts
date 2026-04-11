/**
 * 全局 cache 实例注册表。
 *
 * 所有 cache 实例集中在这里声明，方便：
 *   1. 写操作触发失效时，可以直接 import 对应的实例
 *   2. /api/metrics 端点遍历所有 cache 的命名空间
 *   3. 统一管理 TTL 等参数，避免分散在各个 router 里
 *
 * 命名约定：cache 名字用 domain.resource 的格式，和 tRPC procedure 的
 * path 保持一致，便于在日志里关联。
 */

import { RedisCache } from "../redis-cache";

/**
 * dashboard.stats 的缓存。
 * key = userId
 * TTL = 30 秒（短到用户感知不到，长到能吸收 dashboard 频繁的 refetch）
 *
 * 后端：Redis（跨 Vercel serverless 实例共享）
 * 如果 REDIS_URL 没配或 Redis 不可用，RedisCache 内部会自动降级为
 * "直接走数据源"，不会让应用挂掉。
 *
 * 使用 `any` 作为存储类型，让 `getOrLoad<T>(key, loader)` 从 loader
 * 的返回类型推断出 T，调用方无需手动标注。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dashboardStatsCache = new RedisCache<any>({
  name: "dashboard.stats",
  ttlSeconds: 30,
});

/**
 * 统一失效入口：当 notes/todos 发生写操作时，失效该用户的 dashboard 缓存。
 * 调用方不需要知道 dashboard.stats 的存在，只管"我改了 user X 的 notes"。
 *
 * 注意：RedisCache.invalidate 是异步的（网络 DEL），但这里返回 void
 * 方便调用方继续 fire-and-forget 模式。失效失败不影响主流程 —
 * TTL 也是一致性的安全网。
 */
export function invalidateDashboardForUser(userId: string) {
  void dashboardStatsCache.invalidate(userId).catch(() => undefined);
}
