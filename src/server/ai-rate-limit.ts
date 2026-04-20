import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { aiUsage } from "./db/schema";
import type { Limit } from "./billing/entitlements";

export async function checkAiRateLimit(
  userId: string,
  limit: Limit,
): Promise<{ allowed: boolean; remaining: number | "unlimited" }> {
  if (limit === "unlimited") return { allowed: true, remaining: "unlimited" };

  const today = new Date().toISOString().slice(0, 10);
  const [usage] = await db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.date, today)));

  const currentCount = usage?.count ?? 0;
  return {
    allowed: currentCount < limit,
    remaining: Math.max(0, limit - currentCount),
  };
}

export async function recordAiUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .insert(aiUsage)
    .values({ id: crypto.randomUUID(), userId, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.date],
      set: { count: sql`${aiUsage.count} + 1` },
    });
}
