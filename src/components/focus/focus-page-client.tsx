"use client";

import { startTransition, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  buildTopApps,
  FocusTimeline,
  formatClockLabel,
  formatDateLabel,
  formatFocusDuration,
  getLocalDateString,
} from "./focus-shared";

function shiftDate(date: string, deltaDays: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + deltaDays);
  return getLocalDateString(next);
}

function getWeekStart(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(year, month - 1, day);
  const dayOfWeek = current.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  current.setDate(current.getDate() + diff);
  return getLocalDateString(current);
}

function formatRelativeTime(date: string | Date | null) {
  if (!date) {
    return "Never seen";
  }

  const value = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - value.getTime();
  const diffMins = Math.max(Math.floor(diffMs / 60_000), 0);

  if (diffMins < 1) {
    return "Seen just now";
  }

  if (diffMins < 60) {
    return `Seen ${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `Seen ${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Seen ${diffDays}d ago`;
}

function getDeviceStatus(device: {
  revokedAt: string | Date | null;
  lastSeenAt: string | Date | null;
}) {
  if (device.revokedAt) {
    return {
      label: "Revoked",
      tone:
        "text-stone-400 dark:text-stone-500",
    };
  }

  if (device.lastSeenAt) {
    const lastSeenAt =
      typeof device.lastSeenAt === "string"
        ? new Date(device.lastSeenAt)
        : device.lastSeenAt;
    const diffMs = Date.now() - lastSeenAt.getTime();
    if (diffMs < 5 * 60_000) {
      return {
        label: "Connected",
        tone: "text-emerald-600 dark:text-emerald-300",
      };
    }

    return {
      label: "Recent device",
      tone: "text-sky-600 dark:text-sky-300",
    };
  }

  return {
    label: "Paired",
    tone: "text-amber-600 dark:text-amber-300",
  };
}

function shouldShowFocusBlock(session: {
  focusedSecs?: number;
  durationSecs: number;
  spanSecs?: number;
}) {
  const focusedSecs = session.focusedSecs ?? session.durationSecs;
  const spanSecs = session.spanSecs ?? session.durationSecs;
  return Math.max(focusedSecs, spanSecs) >= 120;
}

export function FocusPageClient() {
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());

  const dailyStats = trpc.focus.dailyStats.useQuery({
    date: selectedDate,
    timeZone,
  });
  const dailySessions = trpc.focus.dailySessions.useQuery({
    date: selectedDate,
    timeZone,
  });
  const displaySessions = trpc.focus.displaySessions.useQuery({
    date: selectedDate,
    timeZone,
  });
  const weeklyStats = trpc.focus.weeklyStats.useQuery({
    weekStart: getWeekStart(selectedDate),
    timeZone,
  });
  const summary = trpc.focus.getDailySummary.useQuery({
    date: selectedDate,
    timeZone,
  });
  const summaryStatus = trpc.focus.summaryStatus.useQuery({
    date: selectedDate,
    timeZone,
  });
  const devices = trpc.focus.listDevices.useQuery();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createPairingCode = trpc.focus.createPairingCode.useMutation({
    onSuccess: async (result) => {
      setPairingCode(result.code);
      setPairingExpiresAt(result.expiresAt);
      setCopied(false);
      await devices.refetch();
    },
  });
  const revokeDevice = trpc.focus.revokeDevice.useMutation({
    onSuccess: async () => {
      await devices.refetch();
    },
  });
  const classifySessions = trpc.focus.classifySessions.useMutation({
    onSuccess: async () => {
      await Promise.all([
        dailySessions.refetch(),
        displaySessions.refetch(),
        dailyStats.refetch(),
        summaryStatus.refetch(),
      ]);
    },
  });
  const generateSummary = trpc.focus.generateSummary.useMutation({
    onSuccess: async () => {
      await Promise.all([summary.refetch(), summaryStatus.refetch()]);
    },
  });

  const topApps = useMemo(
    () => buildTopApps(displaySessions.data ?? []),
    [displaySessions.data]
  );
  const visibleDisplaySessions = useMemo(
    () => (displaySessions.data ?? []).filter(shouldShowFocusBlock),
    [displaySessions.data]
  );
  const goalPct = dailyStats.data
    ? Math.min(100, Math.round((dailyStats.data.workHoursSecs / (8 * 3600)) * 100))
    : 0;
  const goalRemainingSecs = dailyStats.data
    ? Math.max(0, 8 * 3600 - dailyStats.data.workHoursSecs)
    : null;
  const goalReached = dailyStats.data
    ? dailyStats.data.workHoursSecs >= 8 * 3600
    : false;

  return (
    <div className="space-y-6 xl:space-y-8">
      <section className="rounded-[30px] border border-stone-200 bg-white/88 p-6 shadow-[0_28px_80px_-60px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/82">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
              Focus
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
              Focus
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">
              Review local activity sessions uploaded by the desktop collector using true day overlap in your current timezone.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                startTransition(() => setSelectedDate((current) => shiftDate(current, -1)))
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-white dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <ArrowLeft className="h-4 w-4" /> Previous
            </button>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
              {formatDateLabel(selectedDate)}
            </div>
            <button
              type="button"
              onClick={() =>
                startTransition(() => setSelectedDate((current) => shiftDate(current, 1)))
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-white dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                Promise.all([
                  dailyStats.refetch(),
                  dailySessions.refetch(),
                  displaySessions.refetch(),
                  weeklyStats.refetch(),
                  summary.refetch(),
                  summaryStatus.refetch(),
                ])
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-950/60"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-teal-200 bg-teal-50/90 p-5 dark:border-teal-900/60 dark:bg-teal-950/30">
            <div className="text-[11px] uppercase tracking-[0.18em] text-teal-600 dark:text-teal-200/80">
              8h Goal
            </div>
            <div className="mt-2 text-3xl font-semibold text-stone-950 dark:text-stone-50">
              {goalPct}%
            </div>
            <div className="mt-2 text-sm font-medium text-stone-700 dark:text-stone-300">
              {goalReached
                ? "You have reached today's standard."
                : goalRemainingSecs !== null
                  ? `${formatFocusDuration(goalRemainingSecs)} left to reach 8h.`
                  : "Tracking today's progress."}
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/80 dark:bg-stone-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-400"
                style={{ width: `${Math.max(goalPct, 4)}%` }}
              />
            </div>
          </div>

          <div className="rounded-[24px] border border-stone-200 bg-stone-50/90 p-5 dark:border-stone-800 dark:bg-stone-900/60">
            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
              Working Hours
            </div>
            <div
              data-testid="focus-total-secs"
              className="mt-2 text-3xl font-semibold text-stone-950 dark:text-stone-50"
            >
              {dailyStats.data ? formatFocusDuration(dailyStats.data.workHoursSecs) : "--"}
            </div>
            <div className="mt-2 text-sm font-medium text-stone-700 dark:text-stone-300">
              Actual work time recorded for today.
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
              {dailyStats.data ? formatFocusDuration(dailyStats.data.focusedSecs) : "--"} focused time and {dailyStats.data ? formatFocusDuration(dailyStats.data.spanSecs) : "--"} active span
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-stone-500 dark:text-stone-400">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-stone-900/60">
            Longest streak: {dailyStats.data ? formatFocusDuration(dailyStats.data.longestStreakSecs) : "--"}
          </span>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-stone-900/60">
            Focus blocks: {dailyStats.data?.displaySessionCount ?? 0}
          </span>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-stone-900/60">
            App switches: {dailyStats.data?.appSwitches ?? 0}
          </span>
        </div>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Day timeline</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Sessions are positioned by true time of day, not duration share.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
          >
            Back to dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <FocusTimeline sessions={visibleDisplaySessions} testId="focus-day-timeline" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Focus blocks</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Short fragments are merged into larger work blocks before being shown here.
            </p>
          </div>

          <div data-testid="focus-session-list" className="space-y-3">
            {displaySessions.isLoading ? (
              <div className="rounded-[22px] border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400 dark:border-stone-800">
                Loading focus blocks...
              </div>
            ) : visibleDisplaySessions.length ? (
              visibleDisplaySessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-medium text-stone-900 dark:text-stone-100">
                        {session.appName}
                      </div>
                      <div className="mt-1 truncate text-sm text-stone-500 dark:text-stone-400">
                        {session.windowTitle ?? "Untitled window"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm text-stone-500 dark:text-stone-400">
                      <div>{formatFocusDuration(session.focusedSecs ?? session.durationSecs)}</div>
                      <div className="mt-1 text-xs">
                        {formatClockLabel(session.startedAt)}-{formatClockLabel(session.endedAt)}
                      </div>
                      {(session.spanSecs ?? session.durationSecs) >
                      (session.focusedSecs ?? session.durationSecs) ? (
                        <div className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                          span {formatFocusDuration(session.spanSecs ?? session.durationSecs)}
                        </div>
                      ) : null}
                      {session.interruptionCount > 0 ? (
                        <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
                          {session.interruptionCount} short interruption
                          {session.interruptionCount > 1 ? "s" : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-stone-200 px-4 py-10 text-center dark:border-stone-800">
                <div className="text-base font-medium text-stone-900 dark:text-stone-100">
                  No focus blocks for this day
                </div>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                  Short fragments under 2 minutes are hidden from the default view. Upload a few longer sessions to populate this list.
                </p>
              </div>
            )}
          </div>

          <details className="mt-5 rounded-[22px] border border-dashed border-stone-200 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <summary className="cursor-pointer text-sm font-medium text-stone-700 dark:text-stone-300">
              Raw activity
            </summary>
            <div className="mt-4 space-y-3">
              {dailySessions.isLoading ? (
                <div className="text-sm text-stone-400">Loading raw sessions...</div>
              ) : dailySessions.data?.length ? (
                dailySessions.data.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-[18px] border border-stone-200 bg-white/80 p-3 dark:border-stone-800 dark:bg-stone-950/60"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {session.appName}
                        </div>
                        <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">
                          {session.windowTitle ?? "Untitled window"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-stone-500 dark:text-stone-400">
                        <div>{formatFocusDuration(session.durationSecs)}</div>
                        <div className="mt-1">
                          {formatClockLabel(session.startedAt)}-{formatClockLabel(session.endedAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-stone-400">No raw sessions for this day.</div>
              )}
            </div>
          </details>
        </section>

        <div className="space-y-6">
          <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Insights</h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  Classify sessions and generate a daily summary for the selected date.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => classifySessions.mutate({ date: selectedDate, timeZone })}
                  disabled={classifySessions.isPending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-white disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  <RefreshCcw className="h-4 w-4" />
                  {classifySessions.isPending ? "Classifying..." : "Classify sessions"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await classifySessions.mutateAsync({ date: selectedDate, timeZone });
                    await generateSummary.mutateAsync({ date: selectedDate, timeZone });
                  }}
                  disabled={generateSummary.isPending || classifySessions.isPending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800 transition-colors hover:bg-teal-100 disabled:opacity-50 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-100 dark:hover:bg-teal-950/60"
                >
                  <RefreshCcw className="h-4 w-4" />
                  {generateSummary.isPending ? "Generating..." : "Refresh insights"}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-[22px] border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                <span>
                  {summaryStatus.data?.hasPendingInsights ? "Pending classifications" : "Sessions normalized"}
                </span>
                <span>
                  {summaryStatus.data?.isSummaryStale ? "Summary stale" : "Summary current"}
                </span>
              </div>
              <div data-testid="focus-summary-card" className="mt-3 text-sm leading-6 text-stone-700 dark:text-stone-300">
                {summary.data?.aiAnalysis ? (
                  summary.data.aiAnalysis
                ) : (
                  "No generated summary yet. Refresh insights to classify the sessions and synthesize a day-level summary."
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Top apps</h2>
            <div className="mt-4 space-y-3">
              {topApps.length ? (
                topApps.map((app) => (
                  <div key={app.appName} className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-stone-800 dark:text-stone-200">{app.appName}</span>
                      <span className="text-stone-500 dark:text-stone-400">
                        {formatFocusDuration(app.durationSecs)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-900">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-400"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.round((app.durationSecs / Math.max(dailyStats.data?.focusedSecs ?? 1, 1)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-stone-500 dark:text-stone-400">No app usage yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">This week</h2>
            <div className="mt-4 space-y-3">
              {weeklyStats.data?.map((day) => (
                <div key={day.date} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-sm text-stone-500 dark:text-stone-400">
                    {new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", {
                      weekday: "short",
                    })}
                  </div>
                  <div className="h-2 flex-1 rounded-full bg-stone-100 dark:bg-stone-900">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
                      style={{
                        width: `${Math.max(4, Math.round(((day.focusedSecs ?? day.totalSecs) / (8 * 3600)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="w-16 shrink-0 text-right text-sm text-stone-600 dark:text-stone-300">
                    {formatFocusDuration(day.focusedSecs ?? day.totalSecs)}
                  </div>
                </div>
              )) ?? (
                <p className="text-sm text-stone-500 dark:text-stone-400">Loading weekly stats...</p>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Desktop access</h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  Generate a short-lived pairing code, then enter it once in the Tauri collector to bind that desktop automatically.
                </p>
              </div>
              <KeyRound className="h-5 w-5 text-stone-400 dark:text-stone-500" />
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-[20px] border border-dashed border-stone-200 bg-stone-50/70 p-4 text-xs leading-6 text-stone-500 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400">
                Pairing codes expire after 5 minutes and can only be used once. The desktop app will exchange the code for a device-scoped token automatically.
              </div>
              <button
                type="button"
                onClick={() => createPairingCode.mutate()}
                disabled={createPairingCode.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-950/60"
              >
                <KeyRound className="h-4 w-4" />
                {createPairingCode.isPending ? "Generating code..." : "Generate pairing code"}
              </button>
              {createPairingCode.error ? (
                <div className="rounded-[18px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  {createPairingCode.error.message}
                </div>
              ) : null}
            </div>

            {pairingCode ? (
              <div className="mt-4 rounded-[22px] border border-teal-200 bg-teal-50/90 p-4 dark:border-teal-900/60 dark:bg-teal-950/30">
                <div className="text-xs uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300/80">
                  Pairing code
                </div>
                <div className="mt-2 break-all font-mono text-2xl tracking-[0.22em] text-stone-900 dark:text-stone-100">
                  {pairingCode}
                </div>
                <div className="mt-2 text-xs text-stone-600 dark:text-stone-300">
                  Expires at{" "}
                  {pairingExpiresAt
                    ? new Date(pairingExpiresAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "--"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(pairingCode);
                      setCopied(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              {devices.data?.length ? (
                devices.data.map((device) => (
                  (() => {
                    const status = getDeviceStatus(device);
                    return (
                      <div
                        key={device.id}
                        className="flex items-center justify-between gap-4 rounded-[20px] border border-stone-200 bg-stone-50/80 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/50"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                              {device.name}
                            </div>
                            <span
                              className={`text-[11px] font-medium uppercase tracking-[0.18em] ${status.tone}`}
                            >
                              {status.label}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                            {device.deviceId} • token ending {device.tokenPreview}
                          </div>
                          <div className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                            {device.revokedAt
                              ? `Revoked ${formatRelativeTime(device.revokedAt)}`
                              : formatRelativeTime(device.lastSeenAt)}
                          </div>
                        </div>
                        {device.revokedAt ? (
                          <span className="text-xs uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                            Revoked
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => revokeDevice.mutate({ id: device.id })}
                            disabled={revokeDevice.isPending}
                            className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <Trash2 className="h-4 w-4" />
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  })()
                ))
              ) : (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  No desktop devices registered yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
