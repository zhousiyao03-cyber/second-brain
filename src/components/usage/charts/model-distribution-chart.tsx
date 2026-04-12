"use client";

import { PieChart, Pie, Cell, Label } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ModelDistribution } from "@/lib/usage-utils";
import { formatTokens } from "@/lib/usage-utils";

const MODEL_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  if (data.length === 0) return null;

  const totalTokens = data.reduce((sum, d) => sum + d.tokens, 0);
  const chartConfig = Object.fromEntries(
    data.map((d, i) => [
      d.model,
      { label: d.model, color: MODEL_COLORS[i % MODEL_COLORS.length] },
    ]),
  ) satisfies ChartConfig;

  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500 mb-3">
        Token Usage by Model
      </div>
      <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px]">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? formatTokens(value) : String(value)
                }
                nameKey="model"
              />
            }
          />
          <Pie
            data={data}
            dataKey="tokens"
            nameKey="model"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.model}
                fill={MODEL_COLORS[i % MODEL_COLORS.length]}
              />
            ))}
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={viewBox.cx} y={viewBox.cy} className="fill-stone-900 dark:fill-stone-50 text-lg font-bold">
                        {formatTokens(totalTokens)}
                      </tspan>
                      <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-stone-400 dark:fill-stone-500 text-xs">
                        tokens
                      </tspan>
                    </text>
                  );
                }
                return null;
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      {/* Model legend with cost */}
      <div className="mt-3 space-y-1.5">
        {data.map((d, i) => (
          <div key={d.model} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
              />
              <span className="truncate font-mono text-stone-700 dark:text-stone-300">{d.model}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 tabular-nums text-stone-400 dark:text-stone-500">
              <span>{formatTokens(d.tokens)}</span>
              {d.cost > 0 && <span>${d.cost.toFixed(2)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
