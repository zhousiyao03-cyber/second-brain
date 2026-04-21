// src/app/api/billing/checkout/route.ts
import { NextResponse } from "next/server";
import { getRequestSession } from "@/server/auth/request-session";
import { isHostedMode } from "@/server/billing/mode";
import { createCheckoutUrl } from "@/server/billing/lemonsqueezy/checkout";
import { recordBillingEvent } from "@/server/metrics";

export async function POST(req: Request) {
  // Self-hosted users must never reach the hosted Lemon Squeezy flow.
  // Gate comes first so we don't leak "auth required" to non-hosted probes.
  if (!isHostedMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const session = await getRequestSession();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  let body: { variant?: unknown };
  try {
    body = (await req.json()) as { variant?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.variant !== "monthly" && body.variant !== "annual") {
    return NextResponse.json({ error: "Invalid variant" }, { status: 400 });
  }

  recordBillingEvent("billing.checkout.started", { variant: body.variant });

  try {
    const url = await createCheckoutUrl(session.user.id, body.variant);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return NextResponse.json(
      { error: "Checkout creation failed" },
      { status: 500 },
    );
  }
}
