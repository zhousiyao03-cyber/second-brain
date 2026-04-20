// src/server/billing/lemonsqueezy/webhook.ts
import crypto from "node:crypto";
import { db } from "@/server/db";
import { webhookEvents } from "@/server/db/schema/billing";
import { logger } from "@/server/logger";

/**
 * Verify the HMAC-SHA256 signature Lemon Squeezy sends in the `X-Signature`
 * header. Returns `false` for missing secret/signature or any length mismatch,
 * so the caller just needs a single boolean branch.
 */
export function verifyLsSignature(body: string, signature: string | null): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    // Length mismatch etc — signature is invalid
    return false;
  }
}

export type LsWebhookBody = {
  meta: { event_name: string; event_id?: string };
  data: { id: string; attributes: Record<string, unknown> };
};

/**
 * Idempotent persistence of an incoming LS webhook. We rely on the `id`
 * primary-key UNIQUE constraint — a duplicate insert throws and we surface
 * that as `"duplicate"` without re-processing the event.
 */
export async function persistWebhookEvent(
  body: LsWebhookBody,
  raw: string,
  signature: string | null,
): Promise<{ state: "new" | "duplicate"; eventId: string }> {
  const eventId =
    body.meta.event_id ??
    `generated-${crypto.createHash("sha256").update(raw).digest("hex")}`;
  try {
    await db.insert(webhookEvents).values({
      id: eventId,
      eventName: body.meta.event_name,
      payload: raw,
      signature,
    });
    return { state: "new", eventId };
  } catch {
    logger.info({ eventId, event: "ls.webhook.duplicate" }, "LS webhook already recorded");
    return { state: "duplicate", eventId };
  }
}
