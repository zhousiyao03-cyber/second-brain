export const DAILY_PING_HOUR = 5;
export const DAILY_PING_MINUTE = 59;

export function getNextDailyPingAt(
  now = new Date(),
  hour = DAILY_PING_HOUR,
  minute = DAILY_PING_MINUTE
) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (now.getTime() > next.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

export function getDelayUntilNextDailyPing(
  now = new Date(),
  hour = DAILY_PING_HOUR,
  minute = DAILY_PING_MINUTE
) {
  return Math.max(0, getNextDailyPingAt(now, hour, minute).getTime() - now.getTime());
}
