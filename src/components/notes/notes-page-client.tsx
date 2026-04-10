"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, FileText, CalendarDays, Loader2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { NOTE_TYPE_LABELS } from "@/lib/note-appearance";

function parseTags(tags: string | null | undefined) {
  if (!tags) return [] as string[];
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

const PAGE_SIZE = 30;

type NoteItem = {
  id: string;
  userId: string;
  title: string;
  content: string | null;
  plainText: string | null;
  type: "note" | "journal" | "summary" | null;
  icon: string | null;
  cover: string | null;
  tags: string | null;
  shareToken: string | null;
  sharedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export function NotesPageClient() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<NoteItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const prevOffsetRef = useRef(-1);

  const typeParam =
    typeFilter !== "all" ? (typeFilter as "note" | "journal" | "summary") : undefined;

  const { data, isLoading, isFetching } = trpc.notes.list.useQuery({
    limit: PAGE_SIZE,
    offset,
    type: typeParam,
  });

  // Sync fetched data into accumulated items
  useEffect(() => {
    if (!data || prevOffsetRef.current === offset) return;
    prevOffsetRef.current = offset;

    if (offset === 0) {
      setAllItems(data.items as NoteItem[]);
    } else {
      setAllItems((prev) => [...prev, ...(data.items as NoteItem[])]);
    }
    setHasMore(data.hasMore);
  }, [data, offset]);

  // Reset when filter changes
  const handleTypeChange = useCallback((newType: string) => {
    setTypeFilter(newType);
    setOffset(0);
    setAllItems([]);
    setHasMore(true);
    prevOffsetRef.current = -1;
  }, []);

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  }, [hasMore, isFetching]);

  const createNote = trpc.notes.create.useMutation({
    onSuccess: (data) => {
      utils.notes.list.invalidate();
      router.push(`/notes/${data.id}`);
    },
  });
  const openTodayJournal = trpc.notes.openTodayJournal.useMutation({
    onSuccess: (data) => {
      utils.notes.list.invalidate();
      router.push(`/notes/${data.id}`);
    },
  });
  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      // Reset pagination and refetch
      setOffset(0);
      setAllItems([]);
      prevOffsetRef.current = -1;
      utils.notes.list.invalidate();
      toast("Note deleted", "success");
    },
  });

  // Client-side search filter on loaded items
  const filtered = allItems.filter((note) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      note.title?.toLowerCase().includes(q) ||
      note.plainText?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Notes</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openTodayJournal.mutate()}
            disabled={openTodayJournal.isPending}
            className="flex items-center gap-2 px-4 py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            <CalendarDays size={16} />
            {openTodayJournal.isPending ? "Opening today's daily note..." : "Open today's daily note"}
          </button>
          <button
            onClick={() => createNote.mutate({ title: "" })}
            disabled={createNote.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            New note
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All types</option>
          <option value="note">Note</option>
          <option value="journal">Daily note</option>
          <option value="summary">Summary</option>
        </select>
      </div>

      {isLoading && allItems.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText size={48} className="mx-auto mb-3 opacity-50" />
          <p>{allItems.length === 0 ? "No notes yet. Create your first one." : "No matching notes."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((note) => {
            const tags = parseTags(note.tags);
            return (
              <div
                key={note.id}
                onClick={() => router.push(`/notes/${note.id}`)}
                data-testid="note-card"
                className="group flex items-center justify-between rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950/70 dark:hover:bg-stone-900/80"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {note.icon ? (
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white text-xl shadow-sm dark:border-stone-800 dark:bg-stone-950">
                        {note.icon}
                      </div>
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-500">
                        <FileText size={16} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium text-stone-900 dark:text-stone-100">
                        {note.title || "New page"}
                      </h3>
                      {note.type && note.type !== "note" && (
                        <span
                          data-testid="note-type-badge"
                          className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                        >
                          {NOTE_TYPE_LABELS[note.type] ?? note.type}
                        </span>
                      )}
                    </div>
                    {note.plainText && (
                      <p className="mt-1 line-clamp-1 text-xs text-stone-500 dark:text-stone-400">
                        {note.plainText.slice(0, 80)}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-stone-400">
                        {formatDate(note.updatedAt)}
                      </span>
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this note?")) {
                      deleteNote.mutate({ id: note.id });
                    }
                  }}
                  data-testid="note-delete"
                  className={cn(
                    "rounded-xl p-2 text-stone-400 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                  )}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={isFetching}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white/60 py-3 text-sm text-stone-500 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950/50 dark:hover:bg-stone-900/80"
            >
              {isFetching ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
