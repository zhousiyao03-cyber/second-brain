"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  FileText,
  CalendarDays,
  Loader2,
  Folder,
  ChevronRight,
  Menu,
  X,
  GripVertical,
  Network,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { NOTE_TYPE_LABELS } from "@/lib/note-appearance";
import { FolderTree } from "./folder-tree";
import { NotesSidebar } from "./notes-sidebar";
import { DndTreeOverlay } from "./dnd-tree-overlay";
import { ResizableSidebar } from "./resizable-sidebar";

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
  folder: string | null;
  folderId: string | null;
  shareToken: string | null;
  sharedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/** Wrapper to make a note card draggable */
function DraggableNoteCard({
  noteId,
  children,
}: {
  noteId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `note-drag-${noteId}`,
    data: { type: "note", noteId },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={cn("group/drag relative", isDragging && "opacity-40")}
    >
      {/* Drag handle — visible on card hover */}
      <div
        {...listeners}
        className="absolute -left-6 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-1 text-stone-300 opacity-0 transition-opacity hover:text-stone-500 group-hover/drag:opacity-100 active:cursor-grabbing dark:text-stone-600 dark:hover:text-stone-400"
        style={{ touchAction: "none" }}
      >
        <GripVertical size={14} />
      </div>
      {children}
    </div>
  );
}

export function NotesPageClient() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  // null = all, "" = unfiled, string = folderId
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // DnD state
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragActiveType, setDragActiveType] = useState<"note" | "folder" | null>(null);
  const [dragActiveLabel, setDragActiveLabel] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const moveNoteToFolder = trpc.notes.update.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
      utils.folders.list.invalidate();
      toast("Note moved", "success");
    },
  });

  const moveFolderToFolder = trpc.folders.move.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      toast("Folder moved", "success");
    },
  });

  const handleDragStart = (event: { active: { id: string | number; data: { current?: Record<string, unknown> } } }) => {
    const data = event.active.data.current;
    if (data?.type === "note") {
      setDragActiveId(String(event.active.id));
      setDragActiveType("note");
      const note = allItems.find(
        (n) => n.id === (data.noteId as string)
      );
      setDragActiveLabel(note?.title ?? "");
    } else if (data?.type === "folder") {
      setDragActiveId(String(event.active.id));
      setDragActiveType("folder");
      setDragActiveLabel((data.folderName as string) ?? "");
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragActiveId(null);
    setDragActiveType(null);
    setDragActiveLabel("");

    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (!activeData || !overData) return;

    // Note dropped on folder
    if (activeData.type === "note" && overData.type === "folder") {
      const noteId = activeData.noteId as string;
      const targetFolderId = overData.folderId as string;
      moveNoteToFolder.mutate({ id: noteId, folderId: targetFolderId });
    }

    // Note dropped on "All notes" (root) → move out of folder
    if (activeData.type === "note" && overData.type === "folder-root") {
      const noteId = activeData.noteId as string;
      moveNoteToFolder.mutate({ id: noteId, folderId: null });
    }

    // Folder dropped on folder (reparent)
    if (activeData.type === "folder" && overData.type === "folder") {
      const draggedFolderId = activeData.folderId as string;
      const targetFolderId = overData.folderId as string;

      // Don't drop on self
      if (draggedFolderId === targetFolderId) return;

      moveFolderToFolder.mutate({
        id: draggedFolderId,
        targetParentId: targetFolderId,
      });
    }

    // Folder dropped on "All notes" (root) → move to top level
    if (activeData.type === "folder" && overData.type === "folder-root") {
      const draggedFolderId = activeData.folderId as string;
      moveFolderToFolder.mutate({
        id: draggedFolderId,
        targetParentId: null,
      });
    }
  };

  // Get folder name for display
  const { data: folderData = [] } = trpc.folders.list.useQuery();
  const activeFolderName =
    activeFolderId === null
      ? null
      : activeFolderId === ""
        ? "Unfiled notes"
        : folderData.find((f) => f.id === activeFolderId)?.name ?? null;

  // Paginated notes
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<NoteItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const prevKeyRef = useRef("");

  const typeParam =
    typeFilter !== "all"
      ? (typeFilter as "note" | "journal" | "summary")
      : undefined;

  const queryInput: {
    limit: number;
    offset: number;
    type?: "note" | "journal" | "summary";
    folderId?: string;
    noFolder?: boolean;
  } = {
    limit: PAGE_SIZE,
    offset,
    type: typeParam,
  };

  if (activeFolderId !== null) {
    if (activeFolderId === "") {
      queryInput.noFolder = true;
    } else {
      queryInput.folderId = activeFolderId;
    }
  }

  const queryKey = `${typeFilter}|${activeFolderId}`;

  const { data, isLoading, isFetching } = trpc.notes.list.useQuery(queryInput);

  useEffect(() => {
    if (!data) return;
    const currentKey = `${queryKey}|${offset}`;
    if (prevKeyRef.current === currentKey) return;
    prevKeyRef.current = currentKey;

    if (offset === 0) {
      setAllItems(data.items as NoteItem[]);
    } else {
      setAllItems((prev) => [...prev, ...(data.items as NoteItem[])]);
    }
    setHasMore(data.hasMore);
  }, [data, queryKey, offset]);

  const resetAndRefresh = useCallback(() => {
    setOffset(0);
    setAllItems([]);
    setHasMore(true);
    prevKeyRef.current = "";
  }, []);

  const handleFilterChange = useCallback(
    (newType: string) => {
      setTypeFilter(newType);
      resetAndRefresh();
    },
    [resetAndRefresh]
  );

  const handleFolderChange = useCallback(
    (folderId: string | null) => {
      setActiveFolderId(folderId);
      setMobileTreeOpen(false);
      resetAndRefresh();
    },
    [resetAndRefresh]
  );

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  }, [hasMore, isFetching]);

  const createNote = trpc.notes.create.useMutation({
    onSuccess: (data) => {
      utils.notes.list.invalidate();
      utils.folders.list.invalidate();
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
      resetAndRefresh();
      utils.notes.list.invalidate();
      utils.folders.list.invalidate();
      toast("Note deleted", "success");
    },
  });

  const handleCreateNote = useCallback(
    (folderId: string | null) => {
      createNote.mutate({
        title: "",
        folderId: folderId || undefined,
      });
    },
    [createNote]
  );

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
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragActiveId(null);
        setDragActiveType(null);
        setDragActiveLabel("");
      }}
    >
    <div className="flex gap-6">
      {/* Desktop multi-panel sidebar */}
      <ResizableSidebar className="hidden md:block">
        <div className="sticky top-6 h-[calc(100vh-120px)]">
          <NotesSidebar
            activeFolderId={activeFolderId}
            onSelectFolder={handleFolderChange}
            onCreateNote={handleCreateNote}
          />
        </div>
      </ResizableSidebar>

      {/* Mobile tree drawer */}
      {mobileTreeOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileTreeOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-white p-4 shadow-xl dark:bg-stone-950">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                Folders
              </h2>
              <button
                onClick={() => setMobileTreeOpen(false)}
                className="rounded p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X size={18} />
              </button>
            </div>
            <FolderTree
              activeFolderId={activeFolderId}
              onSelectFolder={handleFolderChange}
              onCreateNote={handleCreateNote}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileTreeOpen(true)}
              className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 md:hidden dark:hover:bg-stone-800"
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {activeFolderName ?? "Notes"}
              </h1>
              {activeFolderId && (
                <button
                  onClick={() => handleFolderChange(null)}
                  className="mt-1 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
                >
                  <ChevronRight size={12} className="rotate-180" />
                  All notes
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/notes/graph")}
              className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
              title="Graph View"
            >
              <Network size={16} />
              <span className="hidden lg:inline">Graph</span>
            </button>
            <button
              onClick={() => openTodayJournal.mutate()}
              disabled={openTodayJournal.isPending}
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
            >
              <CalendarDays size={16} />
              <span className="hidden sm:inline">
                {openTodayJournal.isPending
                  ? "Opening..."
                  : "Today's daily note"}
              </span>
            </button>
            <button
              onClick={() => handleCreateNote(activeFolderId === "" ? null : activeFolderId)}
              disabled={createNote.isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus size={16} />
              New note
            </button>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All types</option>
            <option value="note">Note</option>
            <option value="journal">Daily note</option>
            <option value="summary">Summary</option>
          </select>
        </div>

        {isLoading && allItems.length === 0 ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <FileText size={48} className="mx-auto mb-3 opacity-50" />
            <p>
              {allItems.length === 0
                ? "No notes yet. Create your first one."
                : "No matching notes."}
            </p>
          </div>
        ) : (
          <div className="space-y-2 pl-7">
            {filtered.map((note) => {
              const tags = parseTags(note.tags);
              return (
                <DraggableNoteCard key={note.id} noteId={note.id}>
                <div
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
                        {activeFolderId === null && note.folderId && (() => {
                          const f = folderData.find((fd) => fd.id === note.folderId);
                          return f ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                              <Folder size={10} />
                              {f.name}
                            </span>
                          ) : null;
                        })()}
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
                </DraggableNoteCard>
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
    </div>
    <DndTreeOverlay
      activeId={dragActiveId}
      activeType={dragActiveType}
      activeLabel={dragActiveLabel}
    />
    </DndContext>
  );
}
