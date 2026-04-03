"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Plus, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function LearnPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📘");

  const { data: topics = [], isLoading } =
    trpc.learningNotebook.listTopics.useQuery();
  const createTopic = trpc.learningNotebook.createTopic.useMutation({
    onSuccess: async (data) => {
      await utils.learningNotebook.listTopics.invalidate();
      setIsCreating(false);
      setTitle("");
      setDescription("");
      router.push(`/learn/${data.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">
            Learning notebook
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Organize study topics, draft notes with AI, and review your blind spots.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating((open) => !open)}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={16} />
          New topic
        </button>
      </div>

      {isCreating && (
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="grid gap-4 md:grid-cols-[120px,1fr,160px]">
            <label className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <span className="font-medium">Icon</span>
              <input
                aria-label="Icon"
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
              />
            </label>
            <label className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <span className="font-medium">Topic title</span>
              <input
                aria-label="Topic title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
              />
            </label>
            <label className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <span className="font-medium">Description</span>
              <input
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={createTopic.isPending || !title.trim()}
              onClick={() =>
                createTopic.mutate({
                  title,
                  description: description || undefined,
                  icon: icon || undefined,
                })
              }
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 text-sm text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
            >
              {createTopic.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Create topic
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-sm text-stone-500">Loading topics...</div>
      ) : topics.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-stone-300 bg-white/70 px-6 py-16 text-center text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
          <BookOpen className="mx-auto mb-4 h-10 w-10 opacity-50" />
          <p className="text-base font-medium">No study topics yet</p>
          <p className="mt-2 text-sm">
            Create a topic for Go, databases, distributed systems, or anything else
            you are learning.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => router.push(`/learn/${topic.id}`)}
              className="rounded-[28px] border border-stone-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100 text-2xl dark:bg-stone-900">
                  <span className="truncate leading-none">{topic.icon || "📚"}</span>
                </div>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                  {topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}
                </span>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-stone-900 dark:text-stone-100">
                {topic.title}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                {topic.description || "No description yet."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {topic.topTags.length > 0 ? (
                  topic.topTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-stone-400">No tags yet</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
