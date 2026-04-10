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
const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"]; // Monday-first

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
    return "bg-stone-100 dark:bg-stone-800/80";
  }
  const hours = totalSecs / 3600;
  if (hours < 1) return "bg-sky-100 dark:bg-sky-950";
  if (hours < 3) return "bg-sky-300 dark:bg-sky-800";
  if (hours < 5) return "bg-sky-500 dark:bg-sky-600";
  if (hours < 8) return "bg-sky-600 dark:bg-sky-500";
  return "bg-sky-700 dark:bg-sky-400";
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
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    date.getUTCDay()
  ];
  return `${month}月${day}日 (${weekday})`;
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
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            最近 30 天工作时长
          </h2>
        </div>
        <Link
          href="/focus"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400"
        >
          Focus 详情 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 汇总数字 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryStat
          label="总计"
          value={isLoading ? "--" : formatFocusDuration(totalSecs)}
        />
        <SummaryStat
          label="工作日均"
          value={isLoading ? "--" : formatFocusDuration(weekdayAvgSecs)}
          hint={weekdayActiveDays > 0 ? `${weekdayActiveDays} 天` : undefined}
        />
        <SummaryStat
          label="周末日均"
          value={isLoading ? "--" : formatFocusDuration(weekendAvgSecs)}
          hint={weekendActiveDays > 0 ? `${weekendActiveDays} 天` : undefined}
        />
        <SummaryStat
          label="连续"
          value={isLoading ? "--" : `${streak} 天`}
        />
        <SummaryStat
          label="峰值"
          value={
            isLoading || !bestDay
              ? "--"
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
          aria-label="最近 30 天工作时长热力图"
        >
          {isLoading ? (
            <HeatmapSkeleton />
          ) : columns.length === 0 ? (
            <div className="flex h-[140px] flex-1 items-center justify-center text-xs text-stone-400">
              暂无专注数据
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
                          ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-stone-950"
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
      <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
        <span>少</span>
        <span className="h-3 w-3 rounded-[3px] bg-stone-100 dark:bg-stone-800/80" />
        <span className="h-3 w-3 rounded-[3px] bg-sky-100 dark:bg-sky-950" />
        <span className="h-3 w-3 rounded-[3px] bg-sky-300 dark:bg-sky-800" />
        <span className="h-3 w-3 rounded-[3px] bg-sky-500 dark:bg-sky-600" />
        <span className="h-3 w-3 rounded-[3px] bg-sky-600 dark:bg-sky-500" />
        <span className="h-3 w-3 rounded-[3px] bg-sky-700 dark:bg-sky-400" />
        <span>多</span>
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
    <div className="rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800/80 dark:bg-stone-900/40">
      <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-stone-900 dark:text-stone-100">
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] text-stone-400 dark:text-stone-500">
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
              className="h-3.5 w-3.5 animate-pulse rounded-[3px] bg-stone-100 dark:bg-stone-800/60"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
