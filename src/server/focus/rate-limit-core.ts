type RateLimitRecord = {
  count: number;
  windowStart: Date;
};

type RateLimitConfig = {
  now?: Date;
  maxAttempts: number;
  windowSecs: number;
};

export function applyRateLimitWindow(
  existing: RateLimitRecord | null,
  config: RateLimitConfig
) {
  const now = config.now ?? new Date();
  const windowStart = existing?.windowStart ?? now;
  const elapsedSecs = Math.floor((now.getTime() - windowStart.getTime()) / 1000);
  const insideWindow = elapsedSecs >= 0 && elapsedSecs < config.windowSecs;

  if (!existing || !insideWindow) {
    return {
      allowed: true,
      count: 1,
      remaining: Math.max(config.maxAttempts - 1, 0),
      retryAfterSecs: 0,
      windowStart: now,
    };
  }

  if (existing.count >= config.maxAttempts) {
    return {
      allowed: false,
      count: existing.count,
      remaining: 0,
      retryAfterSecs: Math.max(config.windowSecs - elapsedSecs, 0),
      windowStart: existing.windowStart,
    };
  }

  const count = existing.count + 1;
  return {
    allowed: true,
    count,
    remaining: Math.max(config.maxAttempts - count, 0),
    retryAfterSecs: 0,
    windowStart: existing.windowStart,
  };
}
