"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowRight, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useWorkspaceIdentity } from "@/components/layout/workspace-identity-provider";
import {
  buildTopApps,
  FocusTimeline,
  formatFocusDuration,
  getLocalDateString,
} from "@/components/focus/focus-shared";

function getGreetingLabel(hour: number) {
  if (hour < 6) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getUserDisplayName(name?: string | null, email?: string | null) {
  return name?.trim() || email?.split("@")[0]?.trim() || "Today";
}

export default function DashboardPage() {
  const router = useRouter();
  const identity = useWorkspaceIdentity();
  const { data, isLoading } = trpc.dashboard.stats.useQuery();
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const today = useMemo(() => getLocalDateString(), []);
  const focusStats = trpc.focus.dailyStats.useQuery({ date: today, timeZone });
  const focusSessions = trpc.focus.displaySessions.useQuery({ date: today, timeZone });
  const utils = trpc.useUtils();
  const noteCount = isLoading ? "-" : (data?.counts.notes ?? 0);
  const topApps = useMemo(
    () => buildTopApps(focusSessions.data ?? []),
    [focusSessions.data]
  );
  const focusGoalPct = focusStats.data
    ? Math.min(100, Math.round((focusStats.data.workHoursSecs / (8 * 3600)) * 100))
    : 0;
  const greetingLabel = getGreetingLabel(new Date().getHours());
  const displayName = getUserDisplayName(
    identity.name,
    identity.email
  );
  const openTodayJournal = trpc.notes.openTodayJournal.useMutation({
    onSuccess: (data) => {
      void utils.dashboard.stats.invalidate();
      void utils.notes.list.invalidate();
      router.push(`/notes/${data.id}`);
    },
  });

  return (
    <div className="space-y-6 xl:space-y-8">
      <section className="rounded-[30px] border border-stone-200 bg-white/88 p-6 shadow-[0_28px_80px_-60px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/82">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
              {greetingLabel}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
              {displayName}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">
              Jump straight back into the most important context for today: your daily note, recent notes, and active workflow.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => openTodayJournal.mutate()}
              disabled={openTodayJournal.isPending}
              className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
            >
              {openTodayJournal.isPending ? "Opening today's note..." : "Open today's note"}
              <ArrowRight className="h-4 w-4" />
            </button>
            <Link
              href="/notes"
              className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Open notes <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => openTodayJournal.mutate()}
            disabled={openTodayJournal.isPending}
            className="text-left rounded-[24px] border border-amber-200 bg-amber-50/90 p-5 transition-all hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900/70 dark:bg-amber-950/30 dark:hover:border-amber-800 dark:hover:bg-amber-950/40"
          >
            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-500 dark:text-amber-300/80">
              Today
            </div>
            <div className="mt-2 text-xl font-semibold text-stone-950 dark:text-stone-50">
              {openTodayJournal.isPending ? "Preparing today's note..." : "Open today's note"}
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-600 dark:text-stone-300">
              If the note for today does not exist yet, it will be created automatically and seeded with unfinished items from the latest tomorrow plan.
            </div>
          </button>

          <Link
            href="/notes"
            className="rounded-[24px] border border-stone-200 bg-stone-50/90 p-5 transition-all hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700 dark:hover:bg-stone-900"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="mt-5 text-3xl font-semibold text-stone-950 dark:text-stone-50">
              {noteCount}
            </div>
            <div className="mt-1 text-sm font-medium text-stone-700 dark:text-stone-300">Notes</div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
              Recently updated content stays close so you can resume writing from the dashboard.
            </div>
          </Link>

          <div className="rounded-[24px] border border-stone-200 bg-stone-50/90 p-5 dark:border-stone-800 dark:bg-stone-900/60">
            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
              Workspace
            </div>
            <div className="mt-2 text-xl font-semibold text-stone-950 dark:text-stone-50">
              Pick up from your recent notes
            </div>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
              The dashboard keeps only the high-frequency context so your attention stays on the work itself.
            </p>
          </div>

          <Link
            href="/focus"
            aria-label="Open focus page"
            data-testid="dashboard-focus-card"
            className="rounded-[24px] border border-sky-200 bg-sky-50/90 p-5 transition-all hover:border-sky-300 hover:bg-white dark:border-sky-900/60 dark:bg-sky-950/20 dark:hover:border-sky-800 dark:hover:bg-sky-950/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300/80">
                  Working Hours
                </div>
                <div className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
                  {focusStats.data ? formatFocusDuration(focusStats.data.workHoursSecs) : "--"}
                </div>
              </div>
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/80 text-sky-700 shadow-sm dark:bg-stone-900 dark:text-sky-300">
                <Activity className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3 h-2 rounded-full bg-white/80 dark:bg-stone-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-400"
                style={{ width: `${Math.max(6, focusGoalPct)}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              {focusGoalPct}% of an 8h goal
            </div>

            <div className="mt-4">
              <FocusTimeline sessions={focusSessions.data ?? []} compact />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-600 dark:text-stone-300">
              {topApps.length ? (
                topApps.map((app) => (
                  <span
                    key={app.appName}
                    className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 dark:border-stone-700 dark:bg-stone-900"
                  >
                    {app.appName} • {formatFocusDuration(app.durationSecs)}
                  </span>
                ))
              ) : (
                <span className="text-stone-500 dark:text-stone-400">
                  Upload a few sessions from the desktop collector to populate this card.
                </span>
              )}
            </div>
          </Link>
        </div>
      </section>

      <div
        data-testid="dashboard-content-grid"
        className="grid gap-6 xl:grid-cols-12 xl:items-start"
      >
        <section
          data-testid="dashboard-notes-panel"
          className="rounded-[28px] border border-stone-200 bg-white/92 p-5 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88 xl:col-span-12"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Recent notes</h2>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                Jump straight back into your recent work without rebuilding context.
              </p>
            </div>
            <Link
              href="/notes"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="rounded-[22px] border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400 dark:border-stone-800">
                Loading recent notes...
              </div>
            ) : data?.recentNotes.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-stone-200 px-4 py-10 text-center dark:border-stone-800">
                <div className="text-base font-medium text-stone-900 dark:text-stone-100">
                  No notes yet
                </div>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                  Create your first note and the dashboard will start surfacing recent work here.
                </p>
              </div>
            ) : (
              data?.recentNotes.map((note, index) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="block rounded-[22px] border border-stone-200 bg-stone-50/80 p-4 transition-all hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                        Recent {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="mt-2 truncate text-base font-medium text-stone-900 dark:text-stone-100">
                        {note.title || "New page"}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-stone-400 dark:text-stone-500">
                      {note.updatedAt
                        ? new Date(note.updatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
