// src/app/api/billing/invalidate/route.ts
//
// POST /api/billing/invalidate
//
// Closes the race between Lemon Squeezy's post-checkout redirect and the
// webhook: when the user lands back on /settings/billing?status=success the
// billing page invokes this endpoint to drop the cached entitlements so the
// next `billing.me` query rebuilds from the (hopefully by then persisted)
// subscription row.
//
// Safe to call at any time — idempotent cache clear. Self-hosted users never
// reach the billing UI, so this endpoint 404s there for consistency with the
// other /api/billing/* routes.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isHostedMode } from "@/server/billing/mode";
import { invalidateEntitlements } from "@/server/billing/entitlements";

export async function POST() {
  if (!isHostedMode()) {
    return new NextResponse(null, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  await invalidateEntitlements(session.user.id);
  return NextResponse.json({ ok: true });
}
