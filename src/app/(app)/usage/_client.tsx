"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatTokens, estimateCost, aggregateByDate } from "@/lib/usage-utils";
import type { UsageRecord } from "@/lib/usage-utils";
import { TokenCard } from "@/components/usage/token-card";
import {
  ActivityHeatmap,
  DailyTokenChart,
  DailyCostChart,
  ModelDistributionChart,
} from "@/components/usage/charts";

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

type TimeRange = (typeof TIME_RANGES)[number]["days"];

export default function UsageClient() {
  const [days, setDays] = useState<TimeRange>(30);

  // Always fetch 90d, filter client-side
  const { data: usage, isLoading } = trpc.usage.list.useQuery(
    { days: 90 },
    { refetchInterval: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <section className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
              Analytics
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              Token Usage
            </h1>
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-7 w-10 rounded-md bg-stone-100 animate-pulse dark:bg-stone-800" />
            ))}
          </div>
        </section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-md border border-stone-200 bg-stone-50 animate-pulse dark:border-stone-800 dark:bg-stone-900" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="h-64 rounded-md border border-stone-200 bg-stone-50 animate-pulse dark:border-stone-800 dark:bg-stone-900" />
          <div className="h-64 rounded-md border border-stone-200 bg-stone-50 animate-pulse dark:border-stone-800 dark:bg-stone-900" />
        </div>
      </div>
    );
  }

  const allUsage: UsageRecord[] = usage ?? [];

  if (allUsage.length === 0) {
    return (
      <div className="space-y-6">
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            Analytics
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            Token Usage
          </h1>
        </section>
        <div className="flex flex-col items-center rounded-md border border-dashed border-stone-200 py-12 dark:border-stone-800">
          <BarChart3 className="h-8 w-8 text-stone-300 dark:text-stone-600" />
          <p className="mt-3 text-sm text-stone-400 dark:text-stone-500">
            No usage data yet. Start using Claude Code or Codex to see usage here.
          </p>
        </div>
      </div>
    );
  }

  // Filter by selected time range
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const filtered = allUsage.filter((u) => u.date >= cutoff);

  // Compute totals
  const totals = filtered.reduce(
    (acc, u) => ({
      input: acc.input + u.input_tokens,
      output: acc.output + u.output_tokens,
      cacheRead: acc.cacheRead + u.cache_read_tokens,
      cacheWrite: acc.cacheWrite + u.cache_write_tokens,
      cost: acc.cost + estimateCost(u),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );

  const { dailyTokens, dailyCost, modelDist } = aggregateByDate(filtered);

  // Group by date for the table
  const byDate = new Map<string, UsageRecord[]>();
  for (const u of filtered) {
    const existing = byDate.get(u.date) ?? [];
    existing.push(u);
    byDate.set(u.date, existing);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            Analytics
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            Token Usage
          </h1>
        </div>
        <div className="flex gap-0.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => setDays(range.days)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                days === range.days
                  ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                  : "text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TokenCard label="Input" value={formatTokens(totals.input)} />
        <TokenCard label="Output" value={formatTokens(totals.output)} />
        <TokenCard label="Cache Read" value={formatTokens(totals.cacheRead)} />
        <TokenCard label="Cache Write" value={formatTokens(totals.cacheWrite)} />
      </div>

      {/* Cost summary */}
      {totals.cost > 0 && (
        <div className="rounded-md border border-stone-200 bg-white/70 px-4 py-3 dark:border-stone-800 dark:bg-stone-950/50">
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            Estimated cost ({days}d)
          </span>
          <span className="ml-2 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            ${totals.cost.toFixed(2)}
          </span>
        </div>
      )}

      {/* Heatmap */}
      <ActivityHeatmap usage={allUsage} />

      {/* Token & Cost charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DailyTokenChart data={dailyTokens} />
        <DailyCostChart data={dailyCost} />
      </div>

      <ModelDistributionChart data={modelDist} />

      {/* Daily breakdown table */}
      <div className="rounded-md border border-stone-200 dark:border-stone-800">
        <div className="grid grid-cols-[100px_1fr_80px_80px_80px_80px] gap-2 border-b border-stone-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:border-stone-800 dark:text-stone-500">
          <div>Date</div>
          <div>Model</div>
          <div className="text-right">Input</div>
          <div className="text-right">Output</div>
          <div className="text-right">Cache R</div>
          <div className="text-right">Cache W</div>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800/50">
          {[...byDate.entries()].map(([date, rows]) =>
            rows.map((row, i) => (
              <div
                key={`${date}-${row.model}-${i}`}
                className="grid grid-cols-[100px_1fr_80px_80px_80px_80px] gap-2 px-3 py-1.5 text-xs"
              >
                <div className="text-stone-400 dark:text-stone-500">{date}</div>
                <div className="truncate font-mono text-stone-700 dark:text-stone-300">{row.model}</div>
                <div className="text-right tabular-nums text-stone-600 dark:text-stone-400">
                  {formatTokens(row.input_tokens)}
                </div>
                <div className="text-right tabular-nums text-stone-600 dark:text-stone-400">
                  {formatTokens(row.output_tokens)}
                </div>
                <div className="text-right tabular-nums text-stone-600 dark:text-stone-400">
                  {formatTokens(row.cache_read_tokens)}
                </div>
                <div className="text-right tabular-nums text-stone-600 dark:text-stone-400">
                  {formatTokens(row.cache_write_tokens)}
                </div>
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
