"use client";

import { useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate } from "@/lib/utils";

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
  return formatDate(date);
}

export function LearnHomeClient() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");

  const { data: topics, isLoading } = trpc.learningNotebook.listTopics.useQuery();

  const createTopic = trpc.learningNotebook.createTopic.useMutation({
    onSuccess: () => {
      utils.learningNotebook.listTopics.invalidate();
      setIsCreating(false);
      setNewTopicTitle("");
      toast("Topic created", "success");
    },
    onError: (err) => toast(err.message ?? "Failed to create topic", "error"),
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
            <GraduationCap className="h-6 w-6" /> Learning
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Topics and review cards. Tracked by views and three-tier mastery.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          <Plus className="h-4 w-4" /> New Topic
        </button>
      </header>

      {isCreating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTopicTitle.trim();
            if (!title) return;
            createTopic.mutate({ title });
          }}
          className="mb-6 flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
        >
          <input
            autoFocus
            value={newTopicTitle}
            onChange={(event) => setNewTopicTitle(event.target.value)}
            placeholder="Topic name (e.g. React internals)"
            className="flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"
          />
          <button
            type="submit"
            disabled={createTopic.isPending || !newTopicTitle.trim()}
            className="inline-flex items-center rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          >
            {createTopic.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreating(false);
              setNewTopicTitle("");
            }}
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-stone-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !topics || topics.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <GraduationCap className="h-10 w-10 text-stone-300 dark:text-stone-700" />
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No topics yet. Create one to start grouping your study cards.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic) => {
            const noteCount = topic.noteCount;
            const masteredCount = topic.masteredCount;
            const lastReviewedAt = topic.lastReviewedAt;
            return (
              <Link
                key={topic.id}
                href={`/learn/${topic.id}`}
                data-testid="topic-card"
                className="group flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                    {topic.title}
                  </h2>
                </div>
                {topic.description && (
                  <p className="line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                    {topic.description}
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                  <span data-testid="topic-card-counts">
                    <strong className="text-stone-700 dark:text-stone-200">
                      {noteCount}
                    </strong>{" "}
                    cards{" · "}
                    <strong
                      className={cn(
                        masteredCount > 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-stone-700 dark:text-stone-200"
                      )}
                    >
                      {masteredCount}
                    </strong>{" "}
                    mastered
                  </span>
                  <span>{formatRelative(lastReviewedAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
