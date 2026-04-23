"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function PricingTable() {
  const [variant, setVariant] = useState<"monthly" | "annual">("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant }),
      });
      if (!res.ok) {
        setError("Couldn't start checkout. Please try again.");
        setLoading(false);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      // Keep `loading` true — browser is navigating away, button stays disabled.
      window.location.href = url;
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-10 grid gap-6 md:grid-cols-2">
      <Plan
        name="Free"
        price="$0"
        bullets={[
          "20 Ask AI calls / day (bring your own provider)",
          "50 notes",
          "100 MB image storage",
          "3 share links",
          "Core editor, tags, search, dark mode",
        ]}
      />
      <Plan
        name="Pro"
        highlight
        price={variant === "monthly" ? "$9 / mo" : "$90 / yr"}
        toggle={
          <div className="mb-3 inline-flex rounded-full bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
            <button
              type="button"
              className={cn("rounded-full px-3 py-1", variant === "monthly" && "bg-white shadow dark:bg-neutral-700")}
              onClick={() => setVariant("monthly")}
            >
              Monthly
            </button>
            <button
              type="button"
              className={cn("rounded-full px-3 py-1", variant === "annual" && "bg-white shadow dark:bg-neutral-700")}
              onClick={() => setVariant("annual")}
            >
              Annual <span className="ml-1 text-xs text-green-600">Save 17%</span>
            </button>
          </div>
        }
        bullets={[
          "80 Ask AI calls / day (Knosi AI included — no setup)",
          "Unlimited notes",
          "10 GB image storage",
          "Unlimited share links",
          "Portfolio Tracker, Focus Tracker, OSS Projects, Claude Capture",
          "Priority email support",
        ]}
        cta={{
          label: loading ? "Opening checkout…" : "Upgrade to Pro",
          onClick: handleUpgrade,
          loading,
          error,
        }}
      />
    </div>
  );
}

type CTA = {
  label: string;
  onClick: () => void;
  loading?: boolean;
  error?: string | null;
};

function Plan({
  name,
  price,
  bullets,
  cta,
  toggle,
  highlight,
}: {
  name: string;
  price: string;
  bullets: string[];
  cta?: CTA;
  toggle?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-6", highlight && "border-amber-500 shadow-lg")}>
      <h3 className="text-lg font-semibold">{name}</h3>
      {toggle}
      <div className="mt-2 text-3xl font-bold">{price}</div>
      <ul className="mt-4 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
        {bullets.map((b) => (
          <li key={b}>• {b}</li>
        ))}
      </ul>
      {cta && (
        <>
          <button
            type="button"
            className={cn(
              "mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium text-white transition-colors",
              cta.loading
                ? "bg-amber-400 cursor-wait"
                : "bg-amber-500 hover:bg-amber-600",
            )}
            onClick={cta.onClick}
            disabled={cta.loading}
            aria-busy={cta.loading || undefined}
          >
            {cta.loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />}
            {cta.label}
          </button>
          {cta.error && (
            <p
              role="alert"
              className="mt-2 text-center text-xs text-red-600 dark:text-red-400"
            >
              {cta.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
