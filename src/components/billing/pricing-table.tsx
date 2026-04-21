"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function PricingTable() {
  const [variant, setVariant] = useState<"monthly" | "annual">("monthly");

  async function handleUpgrade() {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant }),
    });
    if (!res.ok) {
      alert("Failed to start checkout. Please try again.");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
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
              className={cn("rounded-full px-3 py-1", variant === "monthly" && "bg-white shadow dark:bg-neutral-700")}
              onClick={() => setVariant("monthly")}
            >
              Monthly
            </button>
            <button
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
        cta={{ label: "Upgrade to Pro", onClick: handleUpgrade }}
      />
    </div>
  );
}

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
  cta?: { label: string; onClick: () => void };
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
        <button
          className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2 font-medium text-white hover:bg-amber-600"
          onClick={cta.onClick}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
