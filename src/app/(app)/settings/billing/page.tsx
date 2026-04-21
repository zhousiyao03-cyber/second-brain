"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PricingTable } from "@/components/billing/pricing-table";
import { trpc } from "@/lib/trpc";

export default function BillingPage() {
  const ent = useEntitlements();
  const params = useSearchParams();
  const justUpgraded = params.get("status") === "success";
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!justUpgraded) return;
    // Clear server-side cache immediately so LS webhook lag doesn't leave the UI stale.
    fetch("/api/billing/invalidate", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        void utils.billing.me.invalidate();
      });
  }, [justUpgraded, utils]);

  if (!ent) return <div className="p-6">Loading…</div>;

  if (ent.plan === "pro") {
    const renew = ent.currentPeriodEnd
      ? new Date(ent.currentPeriodEnd).toLocaleDateString()
      : "—";
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Billing</h1>
        {justUpgraded && (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm dark:border-green-800 dark:bg-green-900/20">
            Thanks for upgrading! Your Pro benefits are active.
          </div>
        )}
        <div className="mt-6 rounded-xl border p-6">
          <div>
            Current plan: <strong>Pro</strong>
          </div>
          <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Source: {ent.source} · Next bill: {renew}
          </div>
        </div>
        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/api/billing/portal" className="underline">
            Manage in billing portal
          </Link>{" "}
          — change card, switch plan, cancel, download invoices.
        </p>
        <p className="mt-4 text-xs text-neutral-500">
          Questions? Email{" "}
          <a href="mailto:support@knosi.xyz" className="underline">
            support@knosi.xyz
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {ent.source === "hosted-trial" && ent.trialEndsAt
          ? `Your trial ends ${new Date(ent.trialEndsAt).toLocaleDateString()}.`
          : "You're on the Free plan."}
      </div>
      <PricingTable />
      <p className="mt-6 text-xs text-neutral-500">
        Questions? Email{" "}
        <a href="mailto:support@knosi.xyz" className="underline">
          support@knosi.xyz
        </a>
      </p>
    </div>
  );
}
