"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Crown, Check } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PricingTable } from "@/components/billing/pricing-table";
import { trpc } from "@/lib/trpc";
import type { Entitlements } from "@/server/billing/entitlements";

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

  if (ent.plan === "pro") return <ProView ent={ent} justUpgraded={justUpgraded} />;

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

function ProView({
  ent,
  justUpgraded,
}: {
  ent: Entitlements;
  justUpgraded: boolean;
}) {
  const renew = ent.currentPeriodEnd
    ? new Date(ent.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
  const sourceCopy =
    ent.source === "hosted-grace"
      ? `Access continues until ${renew}`
      : `Renews on ${renew}`;
  const statusCopy = ent.source === "hosted-grace" ? "Grace period" : "Active";

  const benefits = [
    `${ent.limits.askAiPerDay === "unlimited" ? "Unlimited" : ent.limits.askAiPerDay} Ask AI calls per day`,
    ent.limits.notes === "unlimited" ? "Unlimited notes" : `${ent.limits.notes} notes`,
    ent.limits.storageMB === "unlimited"
      ? "Unlimited image storage"
      : `${ent.limits.storageMB >= 1024 ? `${ent.limits.storageMB / 1024} GB` : `${ent.limits.storageMB} MB`} image storage`,
    ent.limits.shareLinks === "unlimited" ? "Unlimited share links" : `${ent.limits.shareLinks} share links`,
    "Portfolio · Focus Tracker · OSS Projects · Claude Capture",
    "Priority email support",
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Membership</h1>

      {justUpgraded && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm dark:border-green-800 dark:bg-green-900/20">
          Thanks for upgrading! Your Pro benefits are active.
        </div>
      )}

      <div className="relative mt-6 overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-50 via-amber-100/60 to-rose-50 p-6 shadow-sm dark:border-amber-500/25 dark:from-amber-950/60 dark:via-amber-900/30 dark:to-rose-950/40">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-400/15" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-md shadow-amber-500/30 dark:from-amber-400 dark:to-amber-600">
            <Crown className="h-6 w-6" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                Knosi Pro
              </span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                {statusCopy}
              </span>
            </div>
            <div className="mt-0.5 text-xl font-semibold text-amber-950 dark:text-amber-50">
              You&apos;re a Pro member
            </div>
            <div className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/70">
              {sourceCopy}
            </div>
          </div>
        </div>

        <ul className="relative mt-5 grid gap-2 border-t border-amber-300/40 pt-4 text-sm text-amber-950 dark:border-amber-500/20 dark:text-amber-50/90 sm:grid-cols-2">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" strokeWidth={2.4} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Link
          href="/api/billing/portal"
          className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
        >
          Manage billing
        </Link>
        <span className="text-neutral-500">change card, switch plan, cancel, invoices</span>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Questions? Email{" "}
        <a href="mailto:support@knosi.xyz" className="underline">
          support@knosi.xyz
        </a>
      </p>
    </div>
  );
}
