"use client";

import { useState, useCallback } from "react";
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
  Menu,
  X,
  GripVertical,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { FolderTree } from "./folder-tree";
import { DndTreeOverlay } from "./dnd-tree-overlay";
import { ResizableSidebar } from "./resizable-sidebar";

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

/** Wrapper to make a note row draggable */
function DraggableNoteRow({
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
      {/* Drag handle — visible on row hover */}
      <div
        {...listeners}
        className="absolute -left-5 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-0.5 text-stone-300 opacity-0 transition-opacity hover:text-stone-500 group-hover/drag:opacity-100 active:cursor-grabbing dark:text-stone-600 dark:hover:text-stone-400"
        style={{ touchAction: "none" }}
      >
        <GripVertical size={13} />
      </div>
      {children}
    </div>
  );
}

export function NotesPageClient() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  // null = all notes (root view); string = folderId
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
      : folderData.find((f) => f.id === activeFolderId)?.name ?? null;

  // Paginated notes
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<NoteItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [lastSyncedKey, setLastSyncedKey] = useState("");

  const queryInput: {
    limit: number;
    offset: number;
    folderId?: string;
  } = {
    limit: PAGE_SIZE,
    offset,
  };

  if (activeFolderId) {
    queryInput.folderId = activeFolderId;
  }

  const queryKey = `${activeFolderId}`;

  const { data, isLoading, isFetching } = trpc.notes.list.useQuery(queryInput);

  // Sync paginated data into local accumulator during render (React 19 pattern:
  // compare previous key via state, not ref, to avoid the no-ref-in-render rule).
  if (data) {
    const currentKey = `${queryKey}|${offset}`;
    if (lastSyncedKey !== currentKey) {
      setLastSyncedKey(currentKey);
      if (offset === 0) {
        setAllItems(data.items as NoteItem[]);
      } else {
        setAllItems((prev) => [...prev, ...(data.items as NoteItem[])]);
      }
      setHasMore(data.hasMore);
    }
  }

  const resetAndRefresh = useCallback(() => {
    setOffset(0);
    setAllItems([]);
    setHasMore(true);
    setLastSyncedKey("");
  }, []);

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
    <div className="-ml-4 flex gap-3 md:-ml-6">
      {/* Desktop multi-panel sidebar */}
      <ResizableSidebar className="hidden md:block">
        <div className="sticky top-6 h-[calc(100vh-120px)] overflow-y-auto pl-2 pr-3">
          <FolderTree
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
      <div className="min-w-0 flex-1 pr-4 md:pr-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileTreeOpen(true)}
              className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 md:hidden dark:hover:bg-stone-800"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {activeFolderName ?? "Notes"}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => openTodayJournal.mutate()}
              disabled={openTodayJournal.isPending}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition-all hover:border-stone-300 hover:bg-white hover:text-stone-900 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100"
            >
              <CalendarDays size={13} />
              <span className="hidden sm:inline">
                {openTodayJournal.isPending ? "Opening..." : "Today"}
              </span>
            </button>
            <button
              onClick={() => handleCreateNote(activeFolderId)}
              disabled={createNote.isPending}
              className="flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              <Plus size={13} />
              New note
            </button>
          </div>
        </div>

        <div className="mb-3">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              type="text"
              placeholder="Search notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-stone-200 bg-white/70 py-1.5 pl-8 pr-3 text-xs text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none dark:border-stone-800 dark:bg-stone-950/50 dark:text-stone-200 dark:focus:border-stone-600"
            />
          </div>
        </div>

        {isLoading && allItems.length === 0 ? (
          <p className="text-sm text-stone-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-stone-400">
            <FileText size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {allItems.length === 0
                ? "No notes yet. Create your first one."
                : "No matching notes."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-stone-200 bg-white/60 pl-6 dark:border-stone-800 dark:bg-stone-950/40">
            {filtered.map((note, idx) => {
              const folderTag =
                activeFolderId === null && note.folderId
                  ? folderData.find((fd) => fd.id === note.folderId)?.name ?? null
                  : null;
              return (
                <DraggableNoteRow key={note.id} noteId={note.id}>
                  <div
                    onClick={() => router.push(`/notes/${note.id}`)}
                    data-testid="note-card"
                    className={cn(
                      "group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60",
                      idx !== 0 &&
                        "border-t border-stone-100 dark:border-stone-900"
                    )}
                  >
                    {note.icon ? (
                      <span className="w-4 shrink-0 text-center text-sm leading-none">
                        {note.icon}
                      </span>
                    ) : (
                      <FileText
                        size={13}
                        className="shrink-0 text-stone-400 dark:text-stone-600"
                      />
                    )}
                    <h3 className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200">
                      {note.title || "New page"}
                    </h3>
                    {folderTag && (
                      <span className="hidden shrink-0 max-w-[120px] truncate text-xs text-stone-400 sm:inline dark:text-stone-500">
                        {folderTag}
                      </span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-stone-400 dark:text-stone-600">
                      {formatDate(note.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this note?")) {
                          deleteNote.mutate({ id: note.id });
                        }
                      }}
                      data-testid="note-delete"
                      className={cn(
                        "shrink-0 rounded p-1 text-stone-400 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                      )}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </DraggableNoteRow>
              );
            })}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={isFetching}
                className="flex w-full items-center justify-center gap-2 border-t border-stone-100 py-2 text-xs text-stone-500 transition-colors hover:bg-stone-50 dark:border-stone-900 dark:hover:bg-stone-900/60"
              >
                {isFetching ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
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
