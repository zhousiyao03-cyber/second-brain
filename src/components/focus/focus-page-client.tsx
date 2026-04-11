"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  KeyRound,
  RefreshCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  FocusTimeline,
  formatClockLabel,
  formatFocusDuration,
  getFocusSessionLabel,
  getLocalDateString,
} from "./focus-shared";
import {
  buildAppGroups,
  getDefaultSelectedApp,
  getSelectedAppDetails,
} from "./focus-app-groups";
import {
  formatRelativeTime,
  getDeviceStatus,
  nonWorkLabels,
} from "./focus-helpers";

// ── Heatmap helpers ─────────────────────────────────────────

const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getCellColor(totalSecs: number) {
  if (totalSecs <= 0) return "bg-stone-100 dark:bg-stone-900";
  const h = totalSecs / 3600;
  if (h < 1) return "bg-stone-200 dark:bg-stone-800";
  if (h < 3) return "bg-stone-400 dark:bg-stone-700";
  if (h < 5) return "bg-stone-500 dark:bg-stone-500";
  if (h < 8) return "bg-stone-700 dark:bg-stone-300";
  return "bg-stone-900 dark:bg-stone-100";
}

function getDayOfWeekIndex(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

function formatFullDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${m}/${d}`;
}

type DayStat = { date: string; totalSecs: number; workHoursSecs: number };
type HeatmapCell = { kind: "empty"; key: string } | { kind: "day"; day: DayStat; isToday: boolean };

function buildHeatmapColumns(days: DayStat[], today: string): HeatmapCell[][] {
  if (days.length === 0) return [];
  const columns: HeatmapCell[][] = [];
  let current: HeatmapCell[] = [];
  const firstWeekday = getDayOfWeekIndex(days[0].date);
  for (let i = 0; i < firstWeekday; i++) current.push({ kind: "empty", key: `pad-${i}` });
  for (const day of days) {
    current.push({ kind: "day", day, isToday: day.date === today });
    if (current.length === 7) { columns.push(current); current = []; }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push({ kind: "empty", key: `pad-end-${current.length}` });
    columns.push(current);
  }
  return columns;
}

// ── Main ────────────────────────────────────────────────────

const RANGE_DAYS = 30;
const GOAL_SECS = 8 * 3600;

export function FocusPageClient() {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const today = useMemo(() => getLocalDateString(), []);
  const [drillDate, setDrillDate] = useState<string | null>(null);

  const rangeStats = trpc.focus.rangeStats.useQuery({ endDate: today, days: RANGE_DAYS, timeZone });
  const days = useMemo<DayStat[]>(() => rangeStats.data ?? [], [rangeStats.data]);
  const columns = useMemo(() => buildHeatmapColumns(days, today), [days, today]);

  const { totalSecs, activeDays, avgSecs, streak, bestDay, weekdayAvgSecs } = useMemo(() => {
    const total = days.reduce((s, d) => s + d.totalSecs, 0);
    const active = days.filter((d) => d.totalSecs > 0);
    let streakCount = 0;
    for (let i = days.length - 1; i >= 0; i--) { if (days[i].totalSecs > 0) streakCount++; else break; }
    const weekdayActive = active.filter((d) => getDayOfWeekIndex(d.date) < 5);
    const best = days.reduce<DayStat | null>((acc, d) => (!acc || d.totalSecs > acc.totalSecs ? d : acc), null);
    return {
      totalSecs: total, activeDays: active.length,
      avgSecs: active.length > 0 ? Math.floor(total / active.length) : 0,
      streak: streakCount, bestDay: best,
      weekdayAvgSecs: weekdayActive.length > 0 ? Math.floor(weekdayActive.reduce((s, d) => s + d.totalSecs, 0) / weekdayActive.length) : 0,
    };
  }, [days]);

  const todayStats = useMemo(() => days.find((d) => d.date === today), [days, today]);
  const todayGoalPct = todayStats ? Math.min(100, Math.round((todayStats.totalSecs / GOAL_SECS) * 100)) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {drillDate && (
        <button type="button" onClick={() => setDrillDate(null)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to overview
        </button>
      )}

      {drillDate ? (
        <DayDrillDown date={drillDate} timeZone={timeZone} />
      ) : (
        <>
          {/* ━━━ 30-day heatmap ━━━ */}
          <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">Focus — Last 30 days</h1>
              <button type="button" onClick={() => rangeStats.refetch()}
                className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300">
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              <MiniStat label="Total" value={formatFocusDuration(totalSecs)} />
              <MiniStat label="Active" value={`${activeDays}d`} />
              <MiniStat label="Daily avg" value={formatFocusDuration(avgSecs)} />
              <MiniStat label="Weekday avg" value={formatFocusDuration(weekdayAvgSecs)} />
              <MiniStat label="Streak" value={`${streak}d`} />
              <MiniStat label="Best" value={bestDay ? formatFocusDuration(bestDay.totalSecs) : "--"} hint={bestDay && bestDay.totalSecs > 0 ? formatShortDate(bestDay.date) : undefined} />
            </div>

            <div className="flex gap-2">
              <div className="flex flex-col justify-between py-[1px] text-[10px] leading-none text-stone-400 dark:text-stone-500">
                {WEEK_LABELS.map((label, i) => (
                  <div key={label} className="flex h-4 items-center" style={{ visibility: i % 2 === 0 ? "visible" : "hidden" }}>{label}</div>
                ))}
              </div>
              <div className="flex flex-1 gap-1 overflow-x-auto" role="grid">
                {rangeStats.isLoading ? <HeatmapSkeleton /> : columns.length === 0 ? (
                  <div className="flex h-[120px] flex-1 items-center justify-center text-xs text-stone-400">No data</div>
                ) : columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-1">
                    {col.map((cell) => cell.kind === "empty" ? (
                      <div key={cell.key} className="h-4 w-4" />
                    ) : (
                      <button key={cell.day.date} type="button" onClick={() => setDrillDate(cell.day.date)}
                        title={`${formatFullDate(cell.day.date)} · ${formatFocusDuration(cell.day.totalSecs)}`}
                        className={`h-4 w-4 rounded-[3px] transition-colors ${getCellColor(cell.day.totalSecs)} ${cell.isToday ? "ring-1 ring-stone-900 ring-offset-1 ring-offset-white dark:ring-stone-100 dark:ring-offset-stone-950" : ""}`} />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-stone-400 dark:text-stone-500">
              <span>Less</span>
              {["bg-stone-100 dark:bg-stone-900", "bg-stone-200 dark:bg-stone-800", "bg-stone-400 dark:bg-stone-700", "bg-stone-500 dark:bg-stone-500", "bg-stone-700 dark:bg-stone-300", "bg-stone-900 dark:bg-stone-100"].map((cls, i) => (
                <span key={i} className={`h-2.5 w-2.5 rounded-[2px] ${cls}`} />
              ))}
              <span>More</span>
            </div>
          </section>

          {/* ━━━ Today card — dashboard style ━━━ */}
          <button type="button" onClick={() => setDrillDate(today)}
            className="w-full rounded-md border border-stone-200 bg-white/70 p-4 text-left transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950/50 dark:hover:bg-stone-900/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Today</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                  {todayStats ? formatFocusDuration(todayStats.totalSecs) : "--"}
                </div>
              </div>
              <span className="text-[11px] text-stone-400 dark:text-stone-500">Click to drill down →</span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-stone-100 dark:bg-stone-900">
              <div className="h-full rounded-full bg-stone-900 transition-colors dark:bg-stone-100" style={{ width: `${Math.max(6, todayGoalPct)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{todayGoalPct}% / 8h goal</div>
          </button>

          {/* ━━━ Recent days ━━━ */}
          {days.filter((d) => d.totalSecs > 0 && d.date !== today).length > 0 && (
            <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Recent days</h2>
              <div className="space-y-1">
                {days.filter((d) => d.totalSecs > 0 && d.date !== today).slice(-7).reverse().map((day) => (
                  <button key={day.date} type="button" onClick={() => setDrillDate(day.date)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <span className="w-24 shrink-0 text-sm text-stone-600 dark:text-stone-300">{formatFullDate(day.date)}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className="h-full rounded-full bg-stone-700 dark:bg-stone-300" style={{ width: `${Math.max(2, Math.min(100, Math.round((day.totalSecs / (10 * 3600)) * 100)))}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm tabular-nums text-stone-500 dark:text-stone-400">{formatFocusDuration(day.totalSecs)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <DevicesSection />
        </>
      )}
    </div>
  );
}

// ── Day drill-down ──────────────────────────────────────────

function DayDrillDown({ date, timeZone }: { date: string; timeZone: string }) {
  const dailyFull = trpc.focus.dailyFull.useQuery({ date, timeZone });
  const dailyInsight = trpc.focus.dailyInsight.useQuery(
    { date, timeZone },
    { staleTime: 5 * 60_000 }
  );
  const dailyStats = dailyFull.data?.stats;
  const dailySessions = dailyFull.data?.sessions;
  const [selectedAppName, setSelectedAppName] = useState<string | null>(null);
  const [showAppSessions, setShowAppSessions] = useState(false);

  const appGroups = useMemo(() => buildAppGroups(dailySessions ?? [], dailyStats?.totalSecs ?? 0), [dailySessions, dailyStats?.totalSecs]);
  const selectedApp = useMemo(() => getSelectedAppDetails(selectedAppName, dailySessions ?? []), [selectedAppName, dailySessions]);

  // Keep selectedAppName valid when appGroups changes (React 19 pattern:
  // render-time setState for data-derived state instead of effect).
  const defaultApp = getDefaultSelectedApp(appGroups);
  if (!defaultApp) {
    if (selectedAppName) setSelectedAppName(null);
  } else if (!selectedAppName || !appGroups.some((g) => g.appName === selectedAppName)) {
    setSelectedAppName(defaultApp);
  }

  const filteredRows = useMemo(() => {
    if (!dailyStats?.nonWorkBreakdown) return [];
    return Object.entries(dailyStats.nonWorkBreakdown)
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, secs]) => ({ reason, secs, label: nonWorkLabels[reason as keyof typeof nonWorkLabels] ?? reason }));
  }, [dailyStats]);

  const isToday = date === getLocalDateString();
  const goalPct = dailyStats ? Math.min(100, Math.round((dailyStats.totalSecs / GOAL_SECS) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* Header with goal bar */}
      <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
              {isToday ? "Today" : formatFullDate(date)}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50" data-testid="focus-total-secs">
              {dailyStats ? formatFocusDuration(dailyStats.totalSecs) : "--"}
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Work</div>
              <div className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                {dailyStats ? formatFocusDuration(dailyStats.workHoursSecs) : "--"}
              </div>
            </div>
            {(dailyStats?.filteredOutSecs ?? 0) > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Filtered</div>
                <div className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                  {formatFocusDuration(dailyStats?.filteredOutSecs ?? 0)}
                </div>
              </div>
            )}
            <button type="button" onClick={() => dailyFull.refetch()}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300">
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 8h goal progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-stone-100 dark:bg-stone-900">
          <div className="h-full rounded-full bg-stone-900 transition-colors dark:bg-stone-100" style={{ width: `${Math.max(4, goalPct)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
          <span>{goalPct}% / 8h goal</span>
          <span data-testid="focus-session-count">{dailyStats?.sessionCount ?? 0} sessions · {dailyStats?.appSwitches ?? 0} switches · streak {dailyStats ? formatFocusDuration(dailyStats.longestStreakSecs) : "--"}</span>
        </div>
      </section>

      {/* Two-column: Left = Apps, Right = AI + Filtered + Selected app */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Left: Apps list */}
        <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Apps</h2>
          <div className="space-y-1">
            {appGroups.length > 0 ? appGroups.map((app) => {
              const active = app.appName === selectedApp?.appName;
              return (
                <button key={app.appName} type="button"
                  onClick={() => { setSelectedAppName(app.appName); setShowAppSessions(false); }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${active ? "bg-stone-100 dark:bg-stone-900/60" : "hover:bg-stone-50 dark:hover:bg-stone-900/60"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={`truncate text-sm font-medium ${active ? "text-stone-900 dark:text-stone-100" : "text-stone-800 dark:text-stone-200"}`}>{app.appName}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-stone-400 dark:text-stone-500">{app.sessionCount}x</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className={`h-full rounded-full ${active ? "bg-stone-700 dark:bg-stone-300" : "bg-stone-300 dark:bg-stone-600"}`} style={{ width: `${Math.max(4, app.percentage)}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-stone-600 dark:text-stone-300">{formatFocusDuration(app.durationSecs)}</span>
                </button>
              );
            }) : <p className="py-8 text-center text-sm text-stone-400 dark:text-stone-500">No activity for this day.</p>}
          </div>
        </section>

        {/* Right: AI Insight + Filtered out + Selected app */}
        <div className="space-y-5">
          {/* AI Insight */}
          {dailyInsight.data && dailyInsight.data.insights.length > 0 && (
            <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
              <div className="mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-stone-400 dark:text-stone-500" />
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">AI Insight</h2>
              </div>
              <ul className="space-y-1.5">
                {dailyInsight.data.insights.map((insight, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400 dark:bg-stone-600" />
                    {insight}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Filtered out */}
          {filteredRows.length > 0 && (
            <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
              <h2 className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                Filtered out <span className="font-normal normal-case tracking-normal tabular-nums text-stone-400 dark:text-stone-500">{formatFocusDuration(dailyStats?.filteredOutSecs ?? 0)}</span>
              </h2>
              <div className="space-y-2">
                {filteredRows.map((row) => (
                  <div key={row.reason} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-stone-600 dark:text-stone-300">{row.label}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className="h-full rounded-full bg-stone-400 dark:bg-stone-600"
                        style={{ width: `${Math.max(8, Math.round((row.secs / Math.max(dailyStats?.filteredOutSecs ?? 1, 1)) * 100))}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-stone-400 dark:text-stone-500">{formatFocusDuration(row.secs)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Selected app detail */}
          {selectedApp && (
            <section data-testid="focus-selected-app" className="rounded-md border border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-950/50">
              <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{selectedApp.appName}</h2>
                  <div className="flex items-center gap-3 text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
                    <span>{formatFocusDuration(selectedApp.durationSecs)}</span>
                    <span>{selectedApp.sessionCount} sessions</span>
                  </div>
                </div>
                <div className="mt-3"><FocusTimeline sessions={selectedApp.sessions} compact /></div>
              </div>
              <button type="button" onClick={() => setShowAppSessions((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-stone-100 px-4 py-2 text-[11px] font-medium text-stone-400 transition-colors hover:bg-stone-50 hover:text-stone-600 dark:border-stone-800 dark:hover:bg-stone-900/60 dark:hover:text-stone-300">
                {showAppSessions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAppSessions ? "Hide sessions" : `Show ${selectedApp.sessionCount} sessions`}
              </button>
              {showAppSessions && (
                <div data-testid="focus-selected-app-sessions" className="border-t border-stone-100 px-4 pb-3 dark:border-stone-800">
                  <div className="divide-y divide-stone-100 dark:divide-stone-800">
                    {selectedApp.sessions.map((session) => (
                      <div key={session.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-stone-700 dark:text-stone-300">
                            {session.windowTitle ?? session.browserHost ?? getFocusSessionLabel(session)}
                          </div>
                          <div className="text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
                            {formatClockLabel(session.startedAt)} - {formatClockLabel(session.endedAt)}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{formatFocusDuration(session.durationSecs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Devices ─────────────────────────────────────────────────

function DevicesSection() {
  const devices = trpc.focus.listDevices.useQuery();
  const [show, setShow] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.focus.createPairingCode.useMutation({
    onSuccess: async (r) => { setCode(r.code); setExpiresAt(r.expiresAt); setCopied(false); await devices.refetch(); },
  });
  const revoke = trpc.focus.revokeDevice.useMutation({
    onSuccess: async () => { await devices.refetch(); },
  });

  return (
    <section className="rounded-md border border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-950/50">
      <button type="button" onClick={() => setShow((v) => !v)} className="flex w-full items-center justify-between gap-2 p-4 text-left">
        <div className="flex items-center gap-2">
          <KeyRound className="h-3 w-3 text-stone-400" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Devices</span>
          <span className="text-[11px] tabular-nums text-stone-400 dark:text-stone-500">{devices.data?.filter((d) => !d.revokedAt).length ?? 0} active</span>
        </div>
        {show ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
      </button>
      {show && (
        <div className="border-t border-stone-100 p-4 pt-3 dark:border-stone-800">
          <button type="button" onClick={() => create.mutate()} disabled={create.isPending}
            className="mb-3 w-full rounded-md border border-dashed border-stone-200 px-3 py-2 text-xs font-medium text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700 disabled:opacity-50 dark:border-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-200">
            {create.isPending ? "Generating..." : "+ Generate pairing code"}
          </button>
          {create.error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{create.error.message}</div>}
          {code && (
            <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="flex items-center justify-between gap-2">
                <code className="text-base font-semibold tracking-widest tabular-nums text-stone-900 dark:text-stone-100">{code}</code>
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }}
                  className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-white/80 hover:text-stone-600 dark:hover:bg-stone-800">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
              <div className="mt-1 text-[11px] tabular-nums text-stone-500 dark:text-stone-400">Expires {expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--"}</div>
            </div>
          )}
          <div className="space-y-2">
            {devices.data?.length ? devices.data.map((device) => {
              const status = getDeviceStatus(device);
              return (
                <div key={device.id} className="flex items-center justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 dark:bg-stone-900/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{device.name}</span>
                      <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${status.tone}`}>{status.label}</span>
                    </div>
                    <div className="text-[11px] text-stone-400 dark:text-stone-500">{device.revokedAt ? `Revoked ${formatRelativeTime(device.revokedAt)}` : formatRelativeTime(device.lastSeenAt)}</div>
                  </div>
                  {!device.revokedAt && (
                    <button type="button" onClick={() => revoke.mutate({ id: device.id })} disabled={revoke.isPending}
                      className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-red-600 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-red-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            }) : <p className="py-2 text-center text-xs text-stone-400 dark:text-stone-500">No devices yet.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Small components ────────────────────────────────────────

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">{value}</div>
      {hint && <div className="text-[10px] tabular-nums text-stone-400 dark:text-stone-500">{hint}</div>}
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div className="flex flex-1 gap-1">
      {Array.from({ length: 6 }, (_, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {Array.from({ length: 7 }, (_, ri) => (
            <div key={ri} className="h-4 w-4 animate-pulse rounded-[3px] bg-stone-100 dark:bg-stone-900" />
          ))}
        </div>
      ))}
    </div>
  );
}
