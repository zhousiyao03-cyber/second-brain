"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
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
  formatDateLabel,
  formatFocusDuration,
  getFocusSessionLabel,
  getLocalDateString,
} from "./focus-shared";
import {
  splitSessionsByDisplayThreshold,
  WEB_FOCUS_DISPLAY_MIN_SECS,
} from "./focus-display";
import {
  buildAppGroups,
  getDefaultSelectedApp,
  getSelectedAppDetails,
} from "./focus-app-groups";
import {
  shiftDate,
  getWeekStart,
  formatRelativeTime,
  getDeviceStatus,
  nonWorkLabels,
} from "./focus-helpers";

// ── Helpers ─────────────────────────────────────────────────

function StatValue({ value, unit, muted }: { value: string; unit?: string; muted?: boolean }) {
  return (
    <span className={muted ? "text-stone-400 dark:text-stone-500" : "text-stone-900 dark:text-stone-50"}>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {unit ? <span className="ml-0.5 text-sm font-medium text-stone-400 dark:text-stone-500">{unit}</span> : null}
    </span>
  );
}

function parseDuration(totalSecs: number) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  if (totalSecs > 0 && totalSecs < 60) return { value: "<1", unit: "m" };
  if (h === 0) return { value: String(m), unit: "m" };
  if (m === 0) return { value: String(h), unit: "h" };
  return { value: `${h}h ${m}`, unit: "m" };
}

// ── Main Component ──────────────────────────────────────────

export function FocusPageClient() {
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const isToday = selectedDate === getLocalDateString();

  // ── Data ──
  const dailyFull = trpc.focus.dailyFull.useQuery({ date: selectedDate, timeZone });
  const dailyStats = dailyFull.data?.stats;
  const dailySessions = dailyFull.data?.sessions;
  const weeklyStats = trpc.focus.weeklyStats.useQuery({
    weekStart: getWeekStart(selectedDate),
    timeZone,
  });
  const summary = trpc.focus.getDailySummary.useQuery({ date: selectedDate, timeZone });
  const summaryStatus = trpc.focus.summaryStatus.useQuery({ date: selectedDate, timeZone });
  const devices = trpc.focus.listDevices.useQuery();

  // ── Mutations ──
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  const createPairingCode = trpc.focus.createPairingCode.useMutation({
    onSuccess: async (result) => {
      setPairingCode(result.code);
      setPairingExpiresAt(result.expiresAt);
      setCopied(false);
      await devices.refetch();
    },
  });
  const revokeDevice = trpc.focus.revokeDevice.useMutation({
    onSuccess: async () => { await devices.refetch(); },
  });
  const classifySessions = trpc.focus.classifySessions.useMutation({
    onSuccess: async () => {
      await Promise.all([dailyFull.refetch(), summaryStatus.refetch()]);
    },
  });
  const generateSummary = trpc.focus.generateSummary.useMutation({
    onSuccess: async () => {
      await Promise.all([summary.refetch(), summaryStatus.refetch()]);
    },
  });

  // ── Derived ──
  const [selectedAppName, setSelectedAppName] = useState<string | null>(null);

  const appGroups = useMemo(
    () => buildAppGroups(dailySessions ?? [], dailyStats?.totalSecs ?? 0),
    [dailySessions, dailyStats?.totalSecs]
  );
  const displaySessionGroups = useMemo(
    () => splitSessionsByDisplayThreshold(dailySessions ?? []),
    [dailySessions]
  );
  const selectedApp = useMemo(
    () => getSelectedAppDetails(selectedAppName, dailySessions ?? []),
    [selectedAppName, dailySessions]
  );

  useEffect(() => {
    const defaultAppName = getDefaultSelectedApp(appGroups);
    if (!defaultAppName) {
      if (selectedAppName !== null) setSelectedAppName(null);
      return;
    }
    if (!selectedAppName || !appGroups.some((g) => g.appName === selectedAppName)) {
      setSelectedAppName(defaultAppName);
    }
  }, [appGroups, selectedAppName]);

  const filteredRows = useMemo(() => {
    if (!dailyStats?.nonWorkBreakdown) return [];
    return Object.entries(dailyStats.nonWorkBreakdown)
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, secs]) => ({
        reason,
        secs,
        label: nonWorkLabels[reason as keyof typeof nonWorkLabels] ?? reason,
      }));
  }, [dailyStats]);

  const summaryText = summary.data?.aiAnalysis?.trim();
  const totalParsed = parseDuration(dailyStats?.totalSecs ?? 0);
  const workParsed = parseDuration(dailyStats?.workHoursSecs ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ━━━ Header: date nav + key stats ━━━ */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => setSelectedDate((c) => shiftDate(c, -1)))}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50">
            {isToday ? "Today" : formatDateLabel(selectedDate)}
          </h1>
          <button
            type="button"
            onClick={() => startTransition(() => setSelectedDate((c) => shiftDate(c, 1)))}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(getLocalDateString())}
              className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Tracked</div>
            <StatValue {...totalParsed} muted={!dailyStats || dailyStats.totalSecs === 0} />
          </div>
          <div className="h-8 w-px bg-stone-200 dark:bg-stone-700" />
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-teal-600 dark:text-teal-400">Work</div>
            <StatValue {...workParsed} muted={!dailyStats || dailyStats.workHoursSecs === 0} />
          </div>
          {(dailyStats?.filteredOutSecs ?? 0) > 0 && (
            <>
              <div className="h-8 w-px bg-stone-200 dark:bg-stone-700" />
              <div className="text-right">
                <div className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Filtered</div>
                <StatValue {...parseDuration(dailyStats?.filteredOutSecs ?? 0)} />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() =>
              Promise.all([dailyFull.refetch(), weeklyStats.refetch(), summary.refetch(), summaryStatus.refetch()])
            }
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
            title="Refresh"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ━━━ Timeline bar ━━━ */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <FocusTimeline
          sessions={displaySessionGroups.visibleSessions}
          testId="focus-day-timeline"
          selectedAppName={selectedApp?.appName ?? null}
        />
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400 dark:text-stone-500">
          <span data-testid="focus-session-count">{dailyStats?.sessionCount ?? 0} sessions</span>
          <span>longest streak {dailyStats ? formatFocusDuration(dailyStats.longestStreakSecs) : "--"}</span>
          <span>{dailyStats?.appSwitches ?? 0} app switches</span>
          {displaySessionGroups.hiddenCount > 0 && (
            <span>{displaySessionGroups.hiddenCount} short blocks ({formatFocusDuration(displaySessionGroups.hiddenTotalSecs)})</span>
          )}
        </div>
      </section>

      {/* ━━━ Main content: 2-column ━━━ */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Left: App breakdown ── */}
        <div className="space-y-5">
          {/* App list */}
          <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <h2 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">Apps</h2>
            <div className="space-y-1">
              {appGroups.length > 0 ? (
                appGroups.map((app) => {
                  const active = app.appName === selectedApp?.appName;
                  return (
                    <button
                      key={app.appName}
                      type="button"
                      onClick={() => setSelectedAppName(app.appName)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "bg-sky-50 dark:bg-sky-950/30"
                          : "hover:bg-stone-50 dark:hover:bg-stone-900/60"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate text-sm font-medium ${active ? "text-sky-700 dark:text-sky-300" : "text-stone-800 dark:text-stone-200"}`}>
                            {app.appName}
                          </span>
                          <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">
                            {app.sessionCount}x
                          </span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-stone-100 dark:bg-stone-800">
                          <div
                            className={`h-full rounded-full ${active ? "bg-sky-400" : "bg-stone-300 dark:bg-stone-600"}`}
                            style={{ width: `${Math.max(4, app.percentage)}%` }}
                          />
                        </div>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-stone-600 dark:text-stone-300">
                        {formatFocusDuration(app.durationSecs)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="py-8 text-center text-sm text-stone-400 dark:text-stone-500">
                  No activity recorded for this day.
                </p>
              )}
            </div>
          </section>

          {/* Selected app detail */}
          {selectedApp && (
            <section
              data-testid="focus-selected-app"
              className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {selectedApp.appName}
                </h2>
                <div className="flex items-center gap-3 text-xs text-stone-400 dark:text-stone-500">
                  <span>{formatFocusDuration(selectedApp.durationSecs)}</span>
                  <span>{selectedApp.sessionCount} sessions</span>
                  <span>longest {formatFocusDuration(selectedApp.longestSessionSecs)}</span>
                </div>
              </div>

              <div className="mt-3">
                <FocusTimeline sessions={selectedApp.sessions} compact />
              </div>

              <div data-testid="focus-selected-app-sessions" className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
                {selectedApp.sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-stone-700 dark:text-stone-300">
                        {session.windowTitle ?? session.browserHost ?? getFocusSessionLabel(session)}
                      </div>
                      <div className="text-xs text-stone-400 dark:text-stone-500">
                        {formatClockLabel(session.startedAt)} - {formatClockLabel(session.endedAt)}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      {formatFocusDuration(session.durationSecs)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-5">
          {/* Weekly */}
          <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <h2 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">This week</h2>
            <div className="space-y-1.5">
              {weeklyStats.data?.map((day) => {
                const isCurrent = day.date === selectedDate;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDate(day.date)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      isCurrent ? "bg-stone-100 dark:bg-stone-800/60" : "hover:bg-stone-50 dark:hover:bg-stone-900/40"
                    }`}
                  >
                    <span className="w-8 shrink-0 text-xs text-stone-400 dark:text-stone-500">
                      {new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <div className="h-1.5 flex-1 rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className={`h-full rounded-full transition-all ${isCurrent ? "bg-sky-400" : "bg-stone-300 dark:bg-stone-600"}`}
                        style={{ width: `${Math.max(2, Math.min(100, Math.round((day.totalSecs / (8 * 3600)) * 100)))}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      {day.totalSecs > 0 ? formatFocusDuration(day.totalSecs) : "--"}
                    </span>
                  </button>
                );
              }) ?? (
                <p className="py-4 text-center text-xs text-stone-400">Loading...</p>
              )}
            </div>
          </section>

          {/* AI Summary */}
          <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Summary
              </h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => classifySessions.mutate({ date: selectedDate, timeZone })}
                  disabled={classifySessions.isPending}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                >
                  {classifySessions.isPending ? "..." : "Classify"}
                </button>
                <button
                  type="button"
                  onClick={() => generateSummary.mutate({ date: selectedDate, timeZone })}
                  disabled={generateSummary.isPending || classifySessions.isPending}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
                >
                  {generateSummary.isPending ? "..." : "Generate"}
                </button>
              </div>
            </div>
            <div data-testid="focus-summary-card" className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
              {summaryText || (
                <span className="text-stone-400 dark:text-stone-500">
                  No summary yet. Click Generate to create one.
                </span>
              )}
            </div>
            {summaryStatus.data?.hasPendingInsights && (
              <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Some sessions haven&apos;t been classified yet.
              </div>
            )}
          </section>

          {/* Filtered out breakdown (only if there's data) */}
          {filteredRows.length > 0 && (
            <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
              <h2 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">
                Filtered out
                <span className="ml-2 text-xs font-normal text-stone-400">
                  {formatFocusDuration(dailyStats?.filteredOutSecs ?? 0)}
                </span>
              </h2>
              <div className="space-y-2">
                {filteredRows.map((row) => (
                  <div key={row.reason} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-stone-600 dark:text-stone-300">{row.label}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className="h-full rounded-full bg-amber-400 dark:bg-amber-500"
                        style={{
                          width: `${Math.max(8, Math.round((row.secs / Math.max(dailyStats?.filteredOutSecs ?? 1, 1)) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-stone-400">
                      {formatFocusDuration(row.secs)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Devices — collapsed by default */}
          <section className="rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <button
              type="button"
              onClick={() => setShowDevices((v) => !v)}
              className="flex w-full items-center justify-between gap-2 p-4 text-left"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-stone-400" />
                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">Devices</span>
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  {devices.data?.filter((d) => !d.revokedAt).length ?? 0} active
                </span>
              </div>
              {showDevices ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
            </button>

            {showDevices && (
              <div className="border-t border-stone-100 p-4 pt-3 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => createPairingCode.mutate()}
                  disabled={createPairingCode.isPending}
                  className="mb-3 w-full rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 dark:border-stone-700 dark:text-stone-400 dark:hover:border-sky-700 dark:hover:text-sky-300"
                >
                  {createPairingCode.isPending ? "Generating..." : "+ Generate pairing code"}
                </button>

                {createPairingCode.error && (
                  <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    {createPairingCode.error.message}
                  </div>
                )}

                {pairingCode && (
                  <div className="mb-3 rounded-lg bg-teal-50 p-3 dark:bg-teal-950/30">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-lg font-semibold tracking-widest text-stone-900 dark:text-stone-100">
                        {pairingCode}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(pairingCode);
                          setCopied(true);
                        }}
                        className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/80 hover:text-stone-600 dark:hover:bg-stone-800"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                      Expires {pairingExpiresAt
                        ? new Date(pairingExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "--"}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {devices.data?.length ? (
                    devices.data.map((device) => {
                      const status = getDeviceStatus(device);
                      return (
                        <div
                          key={device.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-900/50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                                {device.name}
                              </span>
                              <span className={`text-[10px] font-medium uppercase ${status.tone}`}>
                                {status.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-stone-400 dark:text-stone-500">
                              {device.revokedAt
                                ? `Revoked ${formatRelativeTime(device.revokedAt)}`
                                : formatRelativeTime(device.lastSeenAt)}
                            </div>
                          </div>
                          {!device.revokedAt && (
                            <button
                              type="button"
                              onClick={() => revokeDevice.mutate({ id: device.id })}
                              disabled={revokeDevice.isPending}
                              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-red-600 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="py-2 text-center text-xs text-stone-400">No devices yet.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
