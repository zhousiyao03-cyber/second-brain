"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Clock, Crown, Sparkles } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

/**
 * Plan status card rendered at the bottom of the sidebar.
 *
 *   - Self-hosted:             renders nothing (everyone is unlimited Pro)
 *   - Hosted Pro (active):     gold "Pro member" badge → /settings/billing
 *   - Hosted Pro (grace):      same badge, subtext shows when access expires
 *   - Hosted trial:            amber "Pro trial · N days left" → /settings/billing
 *   - Free hosted:             amber "Free plan · Upgrade to Pro" → /settings/billing
 */
export function PlanCard({ collapsed = false }: { collapsed?: boolean }) {
  const ent = useEntitlements();
  const [now] = useState(() => Date.now());
  if (!ent) return null;
  if (ent.source === "self-hosted") return null;

  const isPro =
    ent.plan === "pro" &&
    (ent.source === "hosted-active" || ent.source === "hosted-grace");
  const isTrial = ent.source === "hosted-trial";

  if (isPro) return <ProBadge ent={ent} collapsed={collapsed} />;

  const daysLeft = isTrial
    ? Math.max(0, Math.ceil(((ent.trialEndsAt ?? 0) - now) / 86_400_000))
    : 0;
  const Icon = isTrial ? Clock : Sparkles;
  const label = isTrial ? "Pro trial" : "Free plan";
  const cta = isTrial
    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
    : "Upgrade to Pro";
  // Trial users jump into the in-app settings to manage. Free users go to the
  // marketing /pricing page, which includes the full plan comparison.
  const href = isTrial ? "/settings/billing" : "/pricing";

  if (collapsed) {
    return (
      <Link
        href={href}
        aria-label={isTrial ? `Trial: ${cta}` : cta}
        title={isTrial ? `Trial: ${cta}` : cta}
        className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100/80 text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
      >
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label={isTrial ? `Trial: ${cta}` : cta}
      className={cn(
        "group mx-1 mb-2 flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
        "border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-100/50 hover:border-amber-300 hover:from-amber-100/80 hover:to-amber-100",
        "dark:border-amber-900/40 dark:from-amber-950/30 dark:to-amber-900/20 dark:hover:border-amber-800/70 dark:hover:from-amber-950/50",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
        <Icon className="h-[14px] w-[14px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700/80 dark:text-amber-300/80">
          {label}
        </span>
        <span className="block truncate text-[12.5px] font-medium text-amber-950 dark:text-amber-50">
          {cta}
        </span>
      </span>
      <ArrowUpRight
        className="h-3.5 w-3.5 shrink-0 text-amber-600/70 transition-transform group-hover:-translate-y-px group-hover:translate-x-px dark:text-amber-300/70"
        strokeWidth={2}
      />
    </Link>
  );
}

function ProBadge({
  ent,
  collapsed,
}: {
  ent: NonNullable<ReturnType<typeof useEntitlements>>;
  collapsed: boolean;
}) {
  const isGrace = ent.source === "hosted-grace";
  const subtitle = isGrace && ent.currentPeriodEnd
    ? `Access until ${new Date(ent.currentPeriodEnd).toLocaleDateString()}`
    : "Member";

  if (collapsed) {
    return (
      <Link
        href="/settings/billing"
        aria-label="Pro member"
        title={`Pro member — ${subtitle}`}
        className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-sm shadow-amber-500/30 transition-transform hover:scale-105 dark:from-amber-400 dark:to-amber-600 dark:text-amber-950"
      >
        <Crown className="h-[15px] w-[15px]" strokeWidth={2} />
      </Link>
    );
  }

  return (
    <Link
      href="/settings/billing"
      aria-label="Pro member — manage billing"
      className={cn(
        "group mx-1 mb-2 flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
        "border-amber-300/70 bg-gradient-to-br from-amber-50 via-amber-100/80 to-rose-50 hover:border-amber-400 hover:from-amber-100",
        "dark:border-amber-500/30 dark:from-amber-950/50 dark:via-amber-900/30 dark:to-rose-950/40 dark:hover:border-amber-400/50",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-sm shadow-amber-500/30 dark:from-amber-400 dark:to-amber-600">
        <Crown className="h-[13px] w-[13px]" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700/80 dark:text-amber-300/80">
          Pro
        </span>
        <span className="block truncate text-[12.5px] font-medium text-amber-950 dark:text-amber-50">
          {subtitle}
        </span>
      </span>
      <ArrowUpRight
        className="h-3.5 w-3.5 shrink-0 text-amber-600/70 transition-transform group-hover:-translate-y-px group-hover:translate-x-px dark:text-amber-300/70"
        strokeWidth={2}
      />
    </Link>
  );
}
