/**
 * 内存级 procedure 调用指标聚合。
 *
 * 这是一个极简的进程内 metrics store，仅用于本地观察 / 学习目的。
 * 生产场景应该用 Prometheus / OpenTelemetry 这种外部收集器。
 *
 * 聚合粒度：按 procedure 名称
 * 保留数据：
 *   - 调用次数（总 / 成功 / 失败）
 *   - 错误分类计数（4xx / 5xx）
 *   - 耗时列表（最近 100 条），用于计算 p50 / p95
 */

type ProcedureStats = {
  name: string;
  total: number;
  success: number;
  clientErrors: number; // 4xx 等价：用户输入/权限错误
  serverErrors: number; // 5xx 等价：未预期异常
  durations: number[]; // ring buffer 的简化版
};

const MAX_SAMPLES = 100;
const store = new Map<string, ProcedureStats>();

function getOrCreate(name: string): ProcedureStats {
  let entry = store.get(name);
  if (!entry) {
    entry = {
      name,
      total: 0,
      success: 0,
      clientErrors: 0,
      serverErrors: 0,
      durations: [],
    };
    store.set(name, entry);
  }
  return entry;
}

export type RecordArgs = {
  procedure: string;
  durationMs: number;
  status: "success" | "client_error" | "server_error";
};

export function recordProcedureCall({ procedure, durationMs, status }: RecordArgs) {
  const entry = getOrCreate(procedure);
  entry.total += 1;
  if (status === "success") entry.success += 1;
  else if (status === "client_error") entry.clientErrors += 1;
  else entry.serverErrors += 1;

  entry.durations.push(durationMs);
  if (entry.durations.length > MAX_SAMPLES) {
    entry.durations.shift();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function snapshotMetrics() {
  const entries = Array.from(store.values()).map((entry) => {
    const sorted = [...entry.durations].sort((a, b) => a - b);
    return {
      procedure: entry.name,
      total: entry.total,
      success: entry.success,
      clientErrors: entry.clientErrors,
      serverErrors: entry.serverErrors,
      errorRate: entry.total === 0 ? 0 : (entry.clientErrors + entry.serverErrors) / entry.total,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      samples: sorted.length,
    };
  });

  // 按总调用次数排序
  entries.sort((a, b) => b.total - a.total);
  return {
    generatedAt: new Date().toISOString(),
    procedures: entries,
    caches: snapshotCacheMetrics(),
    operational: snapshotOperationalMetrics(),
  };
}

// ── Cache metrics ────────────────────────────────────────────────
// 按 cache 命名空间聚合 hit/miss/invalidate/clear 次数，便于观察
// 缓存命中率。hit 率越高说明缓存效果越好。

type CacheStats = {
  name: string;
  hits: number;
  misses: number;
  invalidations: number;
  clears: number;
};

const cacheStore = new Map<string, CacheStats>();
type OperationalEventKind = "db_slow_query" | "app_error";

type OperationalEvent = {
  kind: OperationalEventKind;
  at: number;
};

const operationalEvents: OperationalEvent[] = [];
const MAX_OPERATIONAL_EVENTS = 500;

function getOrCreateCache(name: string): CacheStats {
  let entry = cacheStore.get(name);
  if (!entry) {
    entry = { name, hits: 0, misses: 0, invalidations: 0, clears: 0 };
    cacheStore.set(name, entry);
  }
  return entry;
}

export type CacheEventArgs = {
  name: string;
  event: "hit" | "miss" | "invalidate" | "clear";
};

export function recordCacheEvent({ name, event }: CacheEventArgs) {
  const entry = getOrCreateCache(name);
  if (event === "hit") entry.hits += 1;
  else if (event === "miss") entry.misses += 1;
  else if (event === "invalidate") entry.invalidations += 1;
  else entry.clears += 1;
}

export function snapshotCacheMetrics() {
  const entries = Array.from(cacheStore.values()).map((entry) => {
    const total = entry.hits + entry.misses;
    return {
      cache: entry.name,
      hits: entry.hits,
      misses: entry.misses,
      invalidations: entry.invalidations,
      clears: entry.clears,
      hitRate: total === 0 ? 0 : entry.hits / total,
    };
  });
  entries.sort((a, b) => b.hits + b.misses - (a.hits + a.misses));
  return entries;
}

export function recordOperationalEvent(kind: OperationalEventKind) {
  operationalEvents.push({ kind, at: Date.now() });
  if (operationalEvents.length > MAX_OPERATIONAL_EVENTS) {
    operationalEvents.splice(0, operationalEvents.length - MAX_OPERATIONAL_EVENTS);
  }
}

export function snapshotOperationalMetrics(windowMs = 15 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  const recent = operationalEvents.filter((event) => event.at >= cutoff);
  return {
    windowMs,
    slowQueryCount: recent.filter((event) => event.kind === "db_slow_query").length,
    appErrorCount: recent.filter((event) => event.kind === "app_error").length,
  };
}

/** 仅测试用 */
export function _resetMetrics() {
  store.clear();
  cacheStore.clear();
  operationalEvents.length = 0;
}
