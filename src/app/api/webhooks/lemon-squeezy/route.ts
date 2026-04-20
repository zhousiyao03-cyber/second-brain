// src/app/api/webhooks/lemon-squeezy/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { webhookEvents } from "@/server/db/schema/billing";
import { isHostedMode } from "@/server/billing/mode";
import {
  persistWebhookEvent,
  verifyLsSignature,
  type LsWebhookBody,
} from "@/server/billing/lemonsqueezy/webhook";
import { dispatchLsEvent } from "@/server/billing/lemonsqueezy/handlers";
import { logger } from "@/server/logger";

export async function POST(req: Request) {
  // Self-hosted deployments never terminate LS webhooks.
  if (!isHostedMode()) return new NextResponse(null, { status: 404 });

  const raw = await req.text();
  const sig = req.headers.get("x-signature");
  if (!verifyLsSignature(raw, sig)) {
    return new NextResponse("bad signature", { status: 401 });
  }

  const body = JSON.parse(raw) as LsWebhookBody;
  const { state, eventId } = await persistWebhookEvent(body, raw, sig);
  // Ack duplicates so LS stops retrying — we've already processed this one.
  if (state === "duplicate") return new NextResponse("ok", { status: 200 });

  try {
    await dispatchLsEvent(body);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, eventId));
    return new NextResponse("ok", { status: 200 });
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ error: err instanceof Error ? err.stack ?? err.message : String(err) })
      .where(eq(webhookEvents.id, eventId));
    logger.error({ eventId, err }, "LS webhook handler failed");
    return new NextResponse("handler error", { status: 500 });
  }
}
