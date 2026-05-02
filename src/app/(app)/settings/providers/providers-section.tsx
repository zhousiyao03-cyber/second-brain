"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ProviderCard } from "./provider-card";
import { ProviderEditDialog } from "./provider-edit-dialog";

export function ProvidersSection() {
  const { data: providers, isLoading } =
    trpc.aiSettings.listProviders.useQuery();
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-sm text-stone-500">
            Backends that can produce tokens. Add one for each API key /
            endpoint you want to use.
          </p>
        </div>
        <button
          className="shrink-0 rounded bg-stone-900 px-3 py-1 text-sm text-white dark:bg-stone-100 dark:text-stone-900"
          onClick={() => setAdding(true)}
        >
          + Add provider
        </button>
      </div>
      {isLoading ? (
        <div className="text-sm text-stone-500">Loading…</div>
      ) : providers && providers.length > 0 ? (
        <div className="space-y-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <div className="rounded border border-dashed p-4 text-center text-sm text-stone-500">
          No providers yet. Click <strong>Add provider</strong> to get started.
        </div>
      )}
      {adding && (
        <ProviderEditDialog existing={null} onClose={() => setAdding(false)} />
      )}
    </section>
  );
}
