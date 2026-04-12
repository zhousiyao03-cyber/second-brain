"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowRight, CircleDot, Circle, Zap } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  buildTopApps,
  FocusTimeline,
  formatFocusDuration,
  getLocalDateString,
} from "@/components/focus/focus-shared";
import { DailyFocusHeatmap } from "@/components/dashboard/daily-focus-heatmap";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DashboardStatsOutput = RouterOutputs["dashboard"]["stats"];

function getGreetingLabel(hour: number) {
  if (hour < 6) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getUserDisplayName(name?: string | null, email?: string | null) {
  return name?.trim() || email?.split("@")[0]?.trim() || "Today";
}

function formatDate(dateStr: string | Date | null | undefined) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export function DashboardPageClient({
  initialStats,
  identity,
}: {
  initialStats: DashboardStatsOutput;
  identity: { email?: string | null; name?: string | null };
}) {
  const router = useRouter();
  const { data, isLoading } = trpc.dashboard.stats.useQuery(undefined, {
    initialData: initialStats,
    refetchOnMount: false,
  });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const today = useMemo(() => getLocalDateString(), []);
  const focusFull = trpc.focus.dailyFull.useQuery({ date: today, timeZone });
  const focusStats = focusFull.data?.stats;
  const focusSessions = focusFull.data?.sessions;
  const topApps = useMemo(() => buildTopApps(focusSessions ?? []), [focusSessions]);
  const utils = trpc.useUtils();
  const greetingLabel = getGreetingLabel(new Date().getHours());
  const displayName = getUserDisplayName(identity.name, identity.email);
  const focusGoalPct = focusStats
    ? Math.min(100, Math.round((focusStats.totalSecs / (8 * 3600)) * 100))
    : 0;
  const openTodayJournal = trpc.notes.openTodayJournal.useMutation({
    onSuccess: (result) => {
      void utils.dashboard.stats.invalidate();
      void utils.notes.list.invalidate();
      router.push(`/notes/${result.id}`);
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            {greetingLabel}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            {displayName}
          </h1>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => openTodayJournal.mutate()}
            disabled={openTodayJournal.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
          >
            {openTodayJournal.isPending ? "打开中…" : "今日日报"}
            <ArrowRight className="h-3 w-3" />
          </button>
          <Link
            href="/notes"
            className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            所有笔记 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {/* Token → Knowledge */}
      {data?.tokenStats && (
        <section className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            <Zap className="h-3 w-3" />
            Token → Knowledge
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div>
              <div className="text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                {data.tokenStats.monthlyTokens > 0
                  ? `${(data.tokenStats.monthlyTokens / 1000).toFixed(0)}k`
                  : "0"}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-400">tokens this month</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                {data.tokenStats.notesCreatedThisMonth}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-400">notes created</div>
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums text-cyan-600 dark:text-cyan-400">
                {data.tokenStats.conversionRate.toFixed(1)}%
              </div>
              <div className="mt-0.5 text-[11px] text-stone-400">conversion rate</div>
            </div>
          </div>
        </section>
      )}

      {/* Focus Tracking */}
      <Link
        href="/focus"
        data-testid="dashboard-focus-card"
        className="block rounded-md border border-stone-200 bg-white/70 p-4 transition-colors hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-950/50 dark:hover:border-stone-700 dark:hover:bg-stone-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
              <Activity className="h-3 w-3" />
              今日专注
            </div>
            <div className="mt-1.5 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
              {focusStats ? formatFocusDuration(focusStats.totalSecs) : "—"}
            </div>
          </div>
          <div className="text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
            {focusGoalPct}% / 8h
          </div>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-900">
          <div
            className="h-full rounded-full bg-stone-900 transition-all dark:bg-stone-100"
            style={{ width: `${Math.max(3, focusGoalPct)}%` }}
          />
        </div>

        <div className="mt-4">
          <FocusTimeline sessions={focusSessions ?? []} compact />
        </div>

        <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-stone-500 dark:text-stone-400">
          {topApps.length ? (
            topApps.map((app) => (
              <span
                key={app.appName}
                className="rounded border border-stone-200 bg-white px-1.5 py-0.5 dark:border-stone-800 dark:bg-stone-900"
              >
                {app.appName} · {formatFocusDuration(app.durationSecs)}
              </span>
            ))
          ) : (
            <span className="text-stone-400 dark:text-stone-500">
              暂无专注数据
            </span>
          )}
        </div>
      </Link>

      {/* 最近 30 天工作时长热力图 */}
      <DailyFocusHeatmap />

      {/* Main Grid: Recent notes + Today's todos */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent notes */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
              最近笔记
            </h2>
            <Link
              href="/notes"
              className="text-[11px] text-stone-400 transition-colors hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
            >
              查看全部 →
            </Link>
          </div>
          <div className="overflow-hidden rounded-md border border-stone-200 bg-white/60 dark:border-stone-800 dark:bg-stone-950/50">
            {isLoading ? (
              <div className="px-3 py-6 text-center text-xs text-stone-400">
                加载中…
              </div>
            ) : !data?.recentNotes.length ? (
              <div className="px-3 py-6 text-center text-xs text-stone-400">
                暂无笔记
              </div>
            ) : (
              data.recentNotes.map((note, idx) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60 ${
                    idx !== 0
                      ? "border-t border-stone-100 dark:border-stone-900"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200">
                    {note.title || "未命名"}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-stone-400">
                    {formatDate(note.updatedAt)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Today's todos */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
              今日待办
            </h2>
            <Link
              href="/todos"
              className="text-[11px] text-stone-400 transition-colors hover:text-stone-900 dark:text-stone-500 dark:hover:text-stone-100"
            >
              查看全部 →
            </Link>
          </div>
          <div className="overflow-hidden rounded-md border border-stone-200 bg-white/60 dark:border-stone-800 dark:bg-stone-950/50">
            {isLoading ? (
              <div className="px-3 py-6 text-center text-xs text-stone-400">
                加载中…
              </div>
            ) : !data?.todayTodos?.length ? (
              <div className="px-3 py-6 text-center text-xs text-stone-400">
                今天没有待办
              </div>
            ) : (
              data.todayTodos.map((todo, idx) => {
                const isInProgress = todo.status === "in_progress";
                const Icon = isInProgress ? CircleDot : Circle;
                return (
                  <Link
                    key={todo.id}
                    href="/todos"
                    className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60 ${
                      idx !== 0
                        ? "border-t border-stone-100 dark:border-stone-900"
                        : ""
                    }`}
                  >
                    <Icon
                      className={`h-3 w-3 shrink-0 ${
                        isInProgress
                          ? "text-stone-700 dark:text-stone-300"
                          : "text-stone-300 dark:text-stone-600"
                      }`}
                      strokeWidth={2}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200">
                      {todo.title}
                    </span>
                    {todo.priority && (
                      <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                        {todo.priority}
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
