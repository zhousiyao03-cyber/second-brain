"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  formatFocusDuration,
  getLocalDateString,
} from "@/components/focus/focus-shared";

const DAYS = 30;
const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // Monday-first

type DayStat = {
  date: string;
  totalSecs: number;
};

type HeatmapCell =
  | { kind: "empty"; key: string }
  | { kind: "day"; day: DayStat; isToday: boolean };

// 5 档颜色：空 / <1h / 1-3h / 3-5h / 5-8h / 8h+
function getCellColor(totalSecs: number) {
  if (totalSecs <= 0) {
    return "bg-stone-100 dark:bg-stone-900";
  }
  const hours = totalSecs / 3600;
  if (hours < 1) return "bg-stone-200 dark:bg-stone-800";
  if (hours < 3) return "bg-stone-400 dark:bg-stone-700";
  if (hours < 5) return "bg-stone-500 dark:bg-stone-500";
  if (hours < 8) return "bg-stone-700 dark:bg-stone-300";
  return "bg-stone-900 dark:bg-stone-100";
}

// 按 Monday-first 取星期索引，0=Mon...6=Sun
function getDayOfWeekIndex(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun...6=Sat
  return (jsDay + 6) % 7;
}

function formatTooltipDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    date.getUTCDay()
  ];
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  return `${monthName} ${day} (${weekday})`;
}

// 把 30 天按周切成列（Monday-first），首列顶部可能有 empty 占位
function buildColumns(days: DayStat[], today: string): HeatmapCell[][] {
  if (days.length === 0) return [];

  const columns: HeatmapCell[][] = [];
  let current: HeatmapCell[] = [];

  // 第一天前面可能需要 empty 占位，让它落在正确的行
  const firstWeekday = getDayOfWeekIndex(days[0].date);
  for (let i = 0; i < firstWeekday; i += 1) {
    current.push({ kind: "empty", key: `pad-start-${i}` });
  }

  for (const day of days) {
    current.push({
      kind: "day",
      day,
      isToday: day.date === today,
    });
    if (current.length === 7) {
      columns.push(current);
      current = [];
    }
  }

  // 最后一列尾部补 empty
  if (current.length > 0) {
    while (current.length < 7) {
      current.push({ kind: "empty", key: `pad-end-${current.length}` });
    }
    columns.push(current);
  }

  return columns;
}

function computeStreak(days: DayStat[]) {
  // 从最后一天（今天）往前数连续有工作的天数（>0s）
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].totalSecs > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function DailyFocusHeatmap() {
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const today = useMemo(() => getLocalDateString(), []);
  const { data, isLoading } = trpc.focus.rangeStats.useQuery({
    endDate: today,
    days: DAYS,
    timeZone,
  });

  const days = useMemo<DayStat[]>(() => data ?? [], [data]);
  const columns = useMemo(() => buildColumns(days, today), [days, today]);

  const {
    totalSecs,
    weekdayActiveDays,
    weekdayAvgSecs,
    weekendActiveDays,
    weekendAvgSecs,
    streak,
    bestDay,
  } = useMemo(() => {
    const total = days.reduce((s, d) => s + d.totalSecs, 0);
    const weekdayActive: DayStat[] = [];
    const weekendActive: DayStat[] = [];
    for (const d of days) {
      if (d.totalSecs <= 0) continue;
      // getDayOfWeekIndex: 0=Mon..4=Fri, 5=Sat, 6=Sun
      const dow = getDayOfWeekIndex(d.date);
      if (dow >= 5) weekendActive.push(d);
      else weekdayActive.push(d);
    }
    const weekdayTotal = weekdayActive.reduce((s, d) => s + d.totalSecs, 0);
    const weekendTotal = weekendActive.reduce((s, d) => s + d.totalSecs, 0);
    const best = days.reduce<DayStat | null>(
      (acc, d) => (!acc || d.totalSecs > acc.totalSecs ? d : acc),
      null
    );
    return {
      totalSecs: total,
      weekdayActiveDays: weekdayActive.length,
      weekdayAvgSecs:
        weekdayActive.length > 0
          ? Math.floor(weekdayTotal / weekdayActive.length)
          : 0,
      weekendActiveDays: weekendActive.length,
      weekendAvgSecs:
        weekendActive.length > 0
          ? Math.floor(weekendTotal / weekendActive.length)
          : 0,
      streak: computeStreak(days),
      bestDay: best,
    };
  }, [days]);

  return (
    <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
          <Activity className="h-3 w-3" />
          Last 30 Days Focus
        </h2>
        <Link
          href="/focus"
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-stone-400 transition-colors hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
        >
          Focus Details <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 汇总数字 */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryStat
          label="Total"
          value={isLoading ? "—" : formatFocusDuration(totalSecs)}
        />
        <SummaryStat
          label="Weekday Avg"
          value={isLoading ? "—" : formatFocusDuration(weekdayAvgSecs)}
          hint={weekdayActiveDays > 0 ? `${weekdayActiveDays} days` : undefined}
        />
        <SummaryStat
          label="Weekend Avg"
          value={isLoading ? "—" : formatFocusDuration(weekendAvgSecs)}
          hint={weekendActiveDays > 0 ? `${weekendActiveDays} days` : undefined}
        />
        <SummaryStat
          label="Streak"
          value={isLoading ? "—" : `${streak} days`}
        />
        <SummaryStat
          label="Peak"
          value={
            isLoading || !bestDay
              ? "—"
              : formatFocusDuration(bestDay.totalSecs)
          }
          hint={bestDay && bestDay.totalSecs > 0 ? formatTooltipDate(bestDay.date) : undefined}
        />
      </div>

      {/* 热力图网格 */}
      <div className="flex gap-2">
        {/* 星期标签列 */}
        <div className="flex flex-col justify-between py-[1px] text-[10px] leading-none text-stone-400 dark:text-stone-500">
          {WEEK_LABELS.map((label, i) => (
            <div
              key={label}
              className="flex h-3.5 items-center"
              // 只显示周一 / 三 / 五 / 日 减少视觉噪音
              style={{ visibility: i % 2 === 0 ? "visible" : "hidden" }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* 数据列 */}
        <div
          className="flex flex-1 gap-1 overflow-x-auto"
          role="grid"
          aria-label="Last 30 days focus heatmap"
        >
          {isLoading ? (
            <HeatmapSkeleton />
          ) : columns.length === 0 ? (
            <div className="flex h-[140px] flex-1 items-center justify-center text-xs text-stone-400">
              No focus data
            </div>
          ) : (
            columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-1">
                {col.map((cell) =>
                  cell.kind === "empty" ? (
                    <div
                      key={cell.key}
                      className="h-3.5 w-3.5"
                      aria-hidden
                    />
                  ) : (
                    <div
                      key={cell.day.date}
                      role="gridcell"
                      title={`${formatTooltipDate(cell.day.date)} · ${formatFocusDuration(cell.day.totalSecs)}`}
                      className={`h-3.5 w-3.5 rounded-[3px] transition-colors ${getCellColor(cell.day.totalSecs)} ${
                        cell.isToday
                          ? "ring-1 ring-stone-900 ring-offset-1 ring-offset-white dark:ring-stone-100 dark:ring-offset-stone-950"
                          : ""
                      }`}
                    />
                  )
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-stone-400 dark:text-stone-500">
        <span>Less</span>
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-100 dark:bg-stone-900" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-200 dark:bg-stone-800" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-400 dark:bg-stone-700" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-500 dark:bg-stone-500" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-700 dark:bg-stone-300" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-900 dark:bg-stone-100" />
        <span>More</span>
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div className="flex flex-1 gap-1">
      {Array.from({ length: 6 }, (_, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {Array.from({ length: 7 }, (_, ri) => (
            <div
              key={ri}
              className="h-3.5 w-3.5 animate-pulse rounded-[3px] bg-stone-100 dark:bg-stone-900"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
