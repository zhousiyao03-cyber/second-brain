"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Mastery = "not_started" | "learning" | "mastered";
type Filter = "all" | "not_mastered" | "mastered";

const MASTERY_LABEL: Record<Mastery, string> = {
  not_started: "Not yet",
  learning: "Learning",
  mastered: "Mastered",
};

const MASTERY_BADGE_CLASS: Record<Mastery, string> = {
  not_started:
    "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  learning: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  mastered:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

function formatRelative(date: Date | null) {
  if (!date) return "Never";
  const ms = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) return "Just now";
  if (ms < hour) return `${Math.floor(ms / minute)}m ago`;
  if (ms < day) return `${Math.floor(ms / hour)}h ago`;
  if (ms < day * 7) return `${Math.floor(ms / day)}d ago`;
  return date.toLocaleDateString();
}

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

export function LearnTopicClient({ topicId }: { topicId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");

  const { data: topic, isLoading: topicLoading } =
    trpc.learningNotebook.getTopic.useQuery({ id: topicId });

  const { data: notesData, isLoading: notesLoading } =
    trpc.learningNotebook.listNotes.useQuery({
      topicId,
      filter,
      sort: "unmastered_first",
      limit: 100,
    });

  const deleteTopic = trpc.learningNotebook.deleteTopic.useMutation({
    onSuccess: () => {
      utils.learningNotebook.listTopics.invalidate();
      toast("Topic deleted", "success");
      router.push("/learn");
    },
    onError: (err) => toast(err.message ?? "Failed to delete topic", "error"),
  });

  const items = useMemo(() => notesData?.items ?? [], [notesData?.items]);

  const counts = useMemo(() => {
    let mastered = 0;
    let learning = 0;
    let notStarted = 0;
    for (const note of items) {
      const m = note.mastery as Mastery;
      if (m === "mastered") mastered++;
      else if (m === "learning") learning++;
      else notStarted++;
    }
    return { mastered, learning, notStarted, total: items.length };
  }, [items]);

  if (topicLoading) {
    return (
      <div className="flex h-full items-center justify-center text-stone-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-8">
        <p className="text-sm text-stone-500">Topic not found.</p>
        <Link
          href="/learn"
          className="text-sm text-stone-700 underline dark:text-stone-300"
        >
          Back to Learning
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8">
      <header className="mb-6">
        <Link
          href="/learn"
          className="mb-3 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <ArrowLeft className="h-4 w-4" /> All topics
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              {topic.title}
            </h1>
            {topic.description && (
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                {topic.description}
              </p>
            )}
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-500">
              {counts.total} cards · {counts.mastered} mastered ·{" "}
              {counts.learning} learning · {counts.notStarted} not started
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/learn/${topicId}/new`}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <Plus className="h-4 w-4" /> Add Card
            </Link>
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    `Delete topic "${topic.title}"? This will remove all its cards.`
                  )
                ) {
                  deleteTopic.mutate({ id: topicId });
                }
              }}
              className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 hover:bg-stone-50 hover:text-red-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-red-400"
              title="Delete topic"
              aria-label="Delete topic"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <nav
        role="tablist"
        aria-label="Mastery filter"
        className="mb-4 flex gap-1 border-b border-stone-200 dark:border-stone-800"
      >
        {(["all", "not_mastered", "mastered"] as Filter[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "border-b-2 px-3 pb-2 text-sm font-medium transition",
              filter === value
                ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
                : "border-transparent text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            )}
          >
            {value === "all"
              ? "All"
              : value === "not_mastered"
                ? "Not Mastered"
                : "Mastered"}
          </button>
        ))}
      </nav>

      {notesLoading ? (
        <div className="flex flex-1 items-center justify-center text-stone-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-stone-500 dark:text-stone-400">
          No cards in this filter yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((note) => {
            const mastery = (note.mastery ?? "not_started") as Mastery;
            const tags = parseTags(note.tags);
            const lastViewedAt = note.lastViewedAt
              ? new Date(note.lastViewedAt)
              : null;
            return (
              <li key={note.id}>
                <Link
                  href={`/learn/${topicId}/${note.id}`}
                  data-testid="card-row"
                  className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 transition hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                      {note.title || "Untitled"}
                    </div>
                    {tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span
                    className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400"
                    title="View count"
                    data-testid="view-count"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {note.viewCount ?? 0}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-medium",
                      MASTERY_BADGE_CLASS[mastery]
                    )}
                    data-testid="mastery-badge"
                  >
                    {MASTERY_LABEL[mastery]}
                  </span>
                  <span className="hidden w-20 text-right text-xs text-stone-500 sm:inline dark:text-stone-400">
                    {formatRelative(lastViewedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
