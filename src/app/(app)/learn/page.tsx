"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function LearnPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📘");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<{
    id: string;
    title: string;
    description: string;
    icon: string;
  } | null>(null);

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
  const updateTopic = trpc.learningNotebook.updateTopic.useMutation({
    onSuccess: async () => {
      await utils.learningNotebook.listTopics.invalidate();
      setEditingTopic(null);
    },
  });
  const deleteTopic = trpc.learningNotebook.deleteTopic.useMutation({
    onSuccess: async () => {
      await utils.learningNotebook.listTopics.invalidate();
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
            <div
              key={topic.id}
              className="group relative rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700"
            >
              <button
                type="button"
                onClick={() => router.push(`/learn/${topic.id}`)}
                className="w-full text-left"
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

              {/* Topic actions menu */}
              <div className="absolute right-4 top-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === topic.id ? null : topic.id);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 opacity-0 transition-all hover:bg-stone-100 hover:text-stone-600 group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpenId === topic.id && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-xl border border-stone-200 bg-white p-1 shadow-xl dark:border-stone-800 dark:bg-stone-950">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTopic({
                          id: topic.id,
                          title: topic.title,
                          description: topic.description ?? "",
                          icon: topic.icon ?? "📘",
                        });
                        setMenuOpenId(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        if (window.confirm(`Delete "${topic.title}"? This will also delete all notes in this topic.`)) {
                          deleteTopic.mutate({ id: topic.id });
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

      )}

      {/* Edit topic modal */}
      {editingTopic && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditingTopic(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-950"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">
              Edit topic
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={editingTopic.icon}
                  onChange={(e) =>
                    setEditingTopic({ ...editingTopic, icon: e.target.value })
                  }
                  className="w-14 rounded-xl border border-stone-200 bg-stone-50 py-2 text-center text-xl dark:border-stone-700 dark:bg-stone-900"
                  placeholder="📘"
                />
                <input
                  value={editingTopic.title}
                  onChange={(e) =>
                    setEditingTopic({ ...editingTopic, title: e.target.value })
                  }
                  className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-stone-700 dark:bg-stone-950"
                  placeholder="Topic title"
                />
              </div>
              <textarea
                value={editingTopic.description}
                onChange={(e) =>
                  setEditingTopic({ ...editingTopic, description: e.target.value })
                }
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-stone-700 dark:bg-stone-950"
                placeholder="Description (optional)"
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTopic(null)}
                  className="rounded-xl px-4 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!editingTopic.title.trim() || updateTopic.isPending}
                  onClick={() => {
                    updateTopic.mutate({
                      id: editingTopic.id,
                      title: editingTopic.title,
                      description: editingTopic.description || undefined,
                      icon: editingTopic.icon || undefined,
                    });
                  }}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
                >
                  {updateTopic.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
