// src/server/billing/subscriptions.ts
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { subscriptions } from "@/server/db/schema/billing";

export async function getSubscriptionByUserId(userId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ?? null;
}
