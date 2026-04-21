// src/app/api/billing/portal/route.ts
//
// GET /api/billing/portal
//
// Redirects the authenticated user to their Lemon Squeezy customer portal
// (`update_url` captured from the subscription webhook payload). If no
// subscription row exists — e.g. the user hasn't upgraded yet, or the webhook
// hasn't landed — we fall back to /settings/billing so the UI can render the
// pricing table again instead of 500-ing.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import { subscriptions } from "@/server/db/schema/billing";
import { isHostedMode } from "@/server/billing/mode";

export async function GET() {
  if (!isHostedMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const session = await getRequestSession();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  const [row] = await db
    .select({ updateUrl: subscriptions.updateUrl })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);

  const fallback = new URL(
    "/settings/billing",
    process.env.AUTH_URL ?? "http://localhost:3200",
  );
  if (!row?.updateUrl) {
    return NextResponse.redirect(fallback);
  }
  return NextResponse.redirect(row.updateUrl);
}
