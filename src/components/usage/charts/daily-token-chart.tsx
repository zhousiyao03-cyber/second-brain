"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyTokenData } from "@/lib/usage-utils";
import { formatTokens } from "@/lib/usage-utils";

const tokenChartConfig = {
  input: { label: "Input", color: "hsl(var(--chart-1))" },
  output: { label: "Output", color: "hsl(var(--chart-2))" },
  cacheRead: { label: "Cache Read", color: "hsl(var(--chart-3))" },
  cacheWrite: { label: "Cache Write", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

export function DailyTokenChart({ data }: { data: DailyTokenData[] }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500 mb-3">
        Daily Token Usage
      </div>
      <ChartContainer config={tokenChartConfig} className="aspect-[2.5/1] w-full">
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => formatTokens(v)}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? formatTokens(value) : String(value)
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            type="monotone"
            dataKey="input"
            stackId="1"
            stroke="var(--color-input)"
            fill="var(--color-input)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="output"
            stackId="1"
            stroke="var(--color-output)"
            fill="var(--color-output)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheRead"
            stackId="1"
            stroke="var(--color-cacheRead)"
            fill="var(--color-cacheRead)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheWrite"
            stackId="1"
            stroke="var(--color-cacheWrite)"
            fill="var(--color-cacheWrite)"
            fillOpacity={0.4}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
