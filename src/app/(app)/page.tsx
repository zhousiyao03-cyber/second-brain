"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowRight, BookOpen, FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useWorkspaceIdentity } from "@/components/layout/workspace-identity-provider";
import {
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

function formatDate(dateStr: string | Date | null | undefined) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const identity = useWorkspaceIdentity();
  const { data, isLoading } = trpc.dashboard.stats.useQuery();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const today = useMemo(() => getLocalDateString(), []);
  const focusStats = trpc.focus.dailyStats.useQuery({ date: today, timeZone });
  const utils = trpc.useUtils();
  const greetingLabel = getGreetingLabel(new Date().getHours());
  const displayName = getUserDisplayName(identity.name, identity.email);
  const focusGoalPct = focusStats.data
    ? Math.min(100, Math.round((focusStats.data.totalSecs / (8 * 3600)) * 100))
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
      <section className="rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-stone-400 dark:text-stone-500">
              {greetingLabel}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {displayName}
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => openTodayJournal.mutate()}
              disabled={openTodayJournal.isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
            >
              {openTodayJournal.isPending ? "打开中..." : "今日日报"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/notes"
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              所有笔记 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Focus Tracking */}
      <Link
        href="/focus"
        className="flex items-center gap-4 rounded-2xl border border-sky-200 bg-sky-50/80 px-5 py-4 transition-colors hover:border-sky-300 hover:bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/20 dark:hover:border-sky-800 dark:hover:bg-sky-950/30"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-sky-600 shadow-sm dark:bg-stone-900 dark:text-sky-300">
          <Activity className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold text-stone-900 dark:text-stone-50">
              {focusStats.data ? formatFocusDuration(focusStats.data.totalSecs) : "--"}
            </span>
            <span className="text-xs text-stone-500 dark:text-stone-400">今日专注</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/80 dark:bg-stone-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-400 transition-all"
              style={{ width: `${Math.max(4, focusGoalPct)}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{focusGoalPct}% / 8h</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
      </Link>

      {/* Main Grid: Recent Notes + Learn + Projects */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Notes */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">最近笔记</h2>
            <Link
              href="/notes"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              查看全部
            </Link>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-stone-400">加载中...</div>
            ) : !data?.recentNotes.length ? (
              <div className="py-8 text-center text-sm text-stone-400">暂无笔记</div>
            ) : (
              data.recentNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="block rounded-xl border border-stone-100 px-4 py-3 transition-colors hover:border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                      {note.title || "未命名"}
                    </span>
                    <span className="shrink-0 text-xs text-stone-400">{formatDate(note.updatedAt)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Recent Learn Notes */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">学习笔记</h2>
            </div>
            <Link
              href="/learn"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              查看全部
            </Link>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-stone-400">加载中...</div>
            ) : !data?.recentLearnNotes?.length ? (
              <div className="py-8 text-center">
                <p className="text-sm text-stone-400">暂无学习笔记</p>
                <Link href="/learn" className="mt-2 inline-block text-xs text-blue-600 hover:text-blue-700">
                  去创建一个学习主题 →
                </Link>
              </div>
            ) : (
              data.recentLearnNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/learn/${note.topicId}/notes/${note.id}`}
                  className="block rounded-xl border border-stone-100 px-4 py-3 transition-colors hover:border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                        {note.title || "未命名"}
                      </span>
                      <span className="ml-2 text-xs text-stone-400">
                        {note.topicIcon} {note.topicTitle}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-stone-400">{formatDate(note.updatedAt)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Recent Project Notes */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">项目笔记</h2>
            </div>
            <Link
              href="/projects"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              查看全部
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-stone-400 sm:col-span-2 lg:col-span-3">加载中...</div>
            ) : !data?.recentProjectNotes?.length ? (
              <div className="py-8 text-center sm:col-span-2 lg:col-span-3">
                <p className="text-sm text-stone-400">暂无项目笔记</p>
                <Link href="/projects" className="mt-2 inline-block text-xs text-blue-600 hover:text-blue-700">
                  去创建一个项目 →
                </Link>
              </div>
            ) : (
              data.recentProjectNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/projects/${note.projectId}/notes/${note.id}`}
                  className="block rounded-xl border border-stone-100 px-4 py-3 transition-colors hover:border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                >
                  <div className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                    {note.title || "未命名"}
                  </div>
                  <div className="mt-1 text-xs text-stone-400">
                    {note.projectName} · {formatDate(note.updatedAt)}
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
