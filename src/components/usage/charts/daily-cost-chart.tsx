"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyCostData } from "@/lib/usage-utils";

const costChartConfig = {
  cost: { label: "Cost", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

export function DailyCostChart({ data }: { data: DailyCostData[] }) {
  if (data.every((d) => d.cost === 0)) return null;

  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500 mb-3">
        Daily Estimated Cost
      </div>
      <ChartContainer config={costChartConfig} className="aspect-[2.5/1] w-full">
        <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
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
            tickFormatter={(v: number) => `$${v}`}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? `$${value.toFixed(2)}` : String(value)
                }
              />
            }
          />
          <Bar dataKey="cost" fill="var(--color-cost)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
