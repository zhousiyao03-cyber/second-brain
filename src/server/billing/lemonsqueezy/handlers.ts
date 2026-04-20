// src/server/billing/lemonsqueezy/handlers.ts
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { subscriptions } from "@/server/db/schema/billing";
import { invalidateEntitlements } from "../entitlements";
import type { LsWebhookBody } from "./webhook";

type SubAttrs = {
  store_id: number;
  customer_id: number;
  variant_id: number;
  status: "on_trial" | "active" | "past_due" | "cancelled" | "expired" | "paused";
  trial_ends_at: string | null;
  renews_at: string | null;
  ends_at: string | null; // period end
  urls: { update_payment_method: string };
};

function parseDate(s: string | null | undefined): Date | null {
  return s ? new Date(s) : null;
}

function userIdFrom(body: LsWebhookBody): string {
  const meta = body.meta as unknown as { custom_data?: { user_id?: string } };
  const uid = meta.custom_data?.user_id;
  if (!uid) throw new Error("custom_data.user_id missing from LS payload");
  return uid;
}

export async function dispatchLsEvent(body: LsWebhookBody): Promise<void> {
  switch (body.meta.event_name) {
    case "subscription_created":
    case "subscription_updated":
      return upsertSubscription(body);
    case "subscription_cancelled":
      return markCancelled(body);
    case "subscription_expired":
      return updateStatus(body, "expired");
    case "subscription_paused":
      return updateStatus(body, "paused");
    case "subscription_unpaused":
      return updateStatus(body, "active");
    case "subscription_payment_success":
      return handlePaymentSuccess(body);
    case "subscription_payment_failed":
      return updateStatus(body, "past_due");
    case "subscription_payment_recovered":
      return updateStatus(body, "active");
    default:
      return;
  }
}

async function upsertSubscription(body: LsWebhookBody) {
  const userId = userIdFrom(body);
  const lsSubId = body.data.id;
  const attrs = body.data.attributes as unknown as SubAttrs;

  await db
    .insert(subscriptions)
    .values({
      userId,
      lsSubscriptionId: lsSubId,
      lsCustomerId: String(attrs.customer_id),
      lsVariantId: String(attrs.variant_id),
      plan: "pro",
      status: attrs.status,
      currentPeriodEnd: parseDate(attrs.ends_at ?? attrs.renews_at),
      trialEndsAt: parseDate(attrs.trial_ends_at),
      renewsAt: parseDate(attrs.renews_at),
      updateUrl: attrs.urls.update_payment_method,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        lsSubscriptionId: lsSubId,
        lsVariantId: String(attrs.variant_id),
        status: attrs.status,
        currentPeriodEnd: parseDate(attrs.ends_at ?? attrs.renews_at),
        trialEndsAt: parseDate(attrs.trial_ends_at),
        renewsAt: parseDate(attrs.renews_at),
        updateUrl: attrs.urls.update_payment_method,
        updatedAt: new Date(),
      },
    });
  await invalidateEntitlements(userId);
}

async function markCancelled(body: LsWebhookBody) {
  const userId = userIdFrom(body);
  const attrs = body.data.attributes as unknown as SubAttrs;
  await db
    .update(subscriptions)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      currentPeriodEnd: parseDate(attrs.ends_at),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
  await invalidateEntitlements(userId);
}

async function updateStatus(body: LsWebhookBody, status: SubAttrs["status"]) {
  const userId = userIdFrom(body);
  await db
    .update(subscriptions)
    .set({ status, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
  await invalidateEntitlements(userId);
}

async function handlePaymentSuccess(body: LsWebhookBody) {
  const userId = userIdFrom(body);
  const attrs = body.data.attributes as unknown as SubAttrs;
  await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodEnd: parseDate(attrs.ends_at ?? attrs.renews_at),
      renewsAt: parseDate(attrs.renews_at),
      updateUrl: attrs.urls.update_payment_method,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
  await invalidateEntitlements(userId);
}
