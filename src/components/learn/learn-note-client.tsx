"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const TiptapEditor = dynamic(
  () =>
    import("@/components/editor/tiptap-editor").then((m) => m.TiptapEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 py-4">
        <div className="h-4 w-full animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
      </div>
    ),
  }
);

type Mastery = "not_started" | "learning" | "mastered";

const MASTERY_OPTIONS: Array<{ value: Mastery; label: string }> = [
  { value: "not_started", label: "Not yet" },
  { value: "learning", label: "Learning" },
  { value: "mastered", label: "Mastered" },
];

const MASTERY_ACTIVE_CLASS: Record<Mastery, string> = {
  not_started: "bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100",
  learning: "bg-blue-500 text-white dark:bg-blue-500",
  mastered: "bg-green-500 text-white dark:bg-green-500",
};

const VIEW_DEBOUNCE_MS = 5 * 60 * 1000;

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

export function LearnNoteClient({
  topicId,
  noteId,
}: {
  topicId: string;
  noteId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const editRef = useRef<{ title: string; content: string; plainText: string }>({
    title: "",
    content: "",
    plainText: "",
  });
  const incrementedRef = useRef(false);

  const { data: note, isLoading } = trpc.learningNotebook.getNote.useQuery({
    id: noteId,
  });

  const incrementView = trpc.learningNotebook.incrementView.useMutation({
    onSuccess: () => {
      utils.learningNotebook.getNote.invalidate({ id: noteId });
      utils.learningNotebook.listNotes.invalidate({ topicId });
      utils.learningNotebook.listTopics.invalidate();
    },
  });

  const updateMastery = trpc.learningNotebook.updateMastery.useMutation({
    onMutate: async (vars) => {
      // optimistic update
      await utils.learningNotebook.getNote.cancel({ id: noteId });
      const prev = utils.learningNotebook.getNote.getData({ id: noteId });
      if (prev) {
        utils.learningNotebook.getNote.setData(
          { id: noteId },
          { ...prev, mastery: vars.mastery }
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        utils.learningNotebook.getNote.setData({ id: noteId }, ctx.prev);
      }
      toast(err.message ?? "Failed to update mastery", "error");
    },
    onSettled: () => {
      utils.learningNotebook.getNote.invalidate({ id: noteId });
      utils.learningNotebook.listNotes.invalidate({ topicId });
      utils.learningNotebook.listTopics.invalidate();
    },
  });

  const updateNote = trpc.learningNotebook.updateNote.useMutation({
    onSuccess: () => {
      utils.learningNotebook.getNote.invalidate({ id: noteId });
      utils.learningNotebook.listNotes.invalidate({ topicId });
      setEditing(false);
      toast("Card saved", "success");
    },
    onError: (err) => toast(err.message ?? "Failed to save card", "error"),
  });

  const deleteNote = trpc.learningNotebook.deleteNote.useMutation({
    onSuccess: () => {
      utils.learningNotebook.listNotes.invalidate({ topicId });
      utils.learningNotebook.listTopics.invalidate();
      toast("Card deleted", "success");
      router.push(`/learn/${topicId}`);
    },
    onError: (err) => toast(err.message ?? "Failed to delete card", "error"),
  });

  // Increment view (debounced via sessionStorage)
  useEffect(() => {
    if (!note || incrementedRef.current) return;
    incrementedRef.current = true;

    if (typeof window === "undefined") return;
    const storageKey = `learn:view:${noteId}`;
    const lastRaw = window.sessionStorage.getItem(storageKey);
    const last = lastRaw ? Number(lastRaw) : 0;
    const now = Date.now();
    if (Number.isFinite(last) && now - last < VIEW_DEBOUNCE_MS) {
      return;
    }
    window.sessionStorage.setItem(storageKey, String(now));
    incrementView.mutate({ noteId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-stone-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-8">
        <p className="text-sm text-stone-500">Card not found.</p>
        <Link
          href={`/learn/${topicId}`}
          className="text-sm text-stone-700 underline dark:text-stone-300"
        >
          Back to topic
        </Link>
      </div>
    );
  }

  const mastery = (note.mastery ?? "not_started") as Mastery;
  const tags = parseTags(note.tags);
  const lastViewedAt = note.lastViewedAt
    ? new Date(note.lastViewedAt)
    : null;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <div className="mb-4">
        <Link
          href={`/learn/${topicId}`}
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to topic
        </Link>
      </div>

      <header className="sticky top-0 z-10 -mx-6 mb-4 flex items-start justify-between gap-3 border-b border-stone-200 bg-white px-6 py-3 dark:border-stone-800 dark:bg-stone-950">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={note.title ?? ""}
              onChange={(event) => {
                editRef.current.title = event.target.value;
              }}
              className="w-full bg-transparent text-xl font-semibold text-stone-900 outline-none dark:text-stone-100"
              data-testid="card-title-input"
            />
          ) : (
            <h1 className="truncate text-xl font-semibold text-stone-900 dark:text-stone-100">
              {note.title || "Untitled"}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Mastery"
            className="inline-flex overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700"
          >
            {MASTERY_OPTIONS.map((option) => {
              const active = mastery === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`mastery-${option.value}`}
                  onClick={() =>
                    updateMastery.mutate({ noteId, mastery: option.value })
                  }
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition",
                    active
                      ? MASTERY_ACTIVE_CLASS[option.value]
                      : "bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {!editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  editRef.current = {
                    title: note.title ?? "",
                    content: note.content ?? "",
                    plainText: note.plainText ?? "",
                  };
                  setEditing(true);
                }}
                className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
                aria-label="Edit card"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this card?")) {
                    deleteNote.mutate({ id: noteId, topicId });
                  }
                }}
                className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 hover:bg-stone-50 hover:text-red-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-red-400"
                aria-label="Delete card"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  updateNote.mutate({
                    id: noteId,
                    topicId,
                    title: editRef.current.title.trim() || "Untitled",
                    content: editRef.current.content,
                    plainText: editRef.current.plainText,
                  })
                }
                disabled={updateNote.isPending}
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
              >
                {updateNote.isPending ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
        <span className="inline-flex items-center gap-1" data-testid="view-count-meta">
          <Eye className="h-3.5 w-3.5" />
          Viewed {note.viewCount ?? 0} times
        </span>
        <span>Last seen {formatRelative(lastViewedAt)}</span>
        {tags.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-stone-100 px-1.5 py-0.5 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto" data-testid="card-content">
        <TiptapEditor
          key={editing ? "edit" : "read"}
          content={note.content ?? undefined}
          editable={editing}
          onChange={(content, plainText) => {
            editRef.current.content = content;
            editRef.current.plainText = plainText;
          }}
        />
      </div>
    </div>
  );
}
