import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { focusPairingRateLimits } from "../db/schema";
import { applyRateLimitWindow } from "./rate-limit-core";

function normalizeKey(input: string) {
  return createHash("sha256")
    .update(input.trim().toLowerCase())
    .digest("hex");
}

export async function enforceFocusRateLimit(input: {
  scope: string;
  key: string;
  maxAttempts: number;
  windowSecs: number;
}) {
  const normalizedKey = normalizeKey(input.key);
  const now = new Date();

  const [existing] = await db
    .select({
      id: focusPairingRateLimits.id,
      count: focusPairingRateLimits.count,
      windowStart: focusPairingRateLimits.windowStart,
    })
    .from(focusPairingRateLimits)
    .where(
      and(
        eq(focusPairingRateLimits.scope, input.scope),
        eq(focusPairingRateLimits.key, normalizedKey)
      )
    )
    .limit(1);

  const next = applyRateLimitWindow(existing ?? null, {
    now,
    maxAttempts: input.maxAttempts,
    windowSecs: input.windowSecs,
  });

  if (existing) {
    await db
      .update(focusPairingRateLimits)
      .set({
        count: next.count,
        windowStart: next.windowStart,
        updatedAt: now,
      })
      .where(eq(focusPairingRateLimits.id, existing.id));
  } else {
    await db.insert(focusPairingRateLimits).values({
      scope: input.scope,
      key: normalizedKey,
      count: next.count,
      windowStart: next.windowStart,
      createdAt: now,
      updatedAt: now,
    });
  }

  return next;
}
