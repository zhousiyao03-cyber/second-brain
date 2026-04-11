"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, FolderOpen, ImagePlus, Link, Share2, X } from "lucide-react";
import dynamic from "next/dynamic";
import type { Editor as TiptapEditorInstance } from "@tiptap/react";
import { BacklinksPanel } from "./backlinks-panel";
import { TocSidebar } from "@/components/editor/toc-sidebar";

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
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { cn, formatDate } from "@/lib/utils";
import {
  NOTE_COVER_OPTIONS,
  getNoteCoverOption,
} from "@/lib/note-appearance";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type NoteOutput = RouterOutputs["notes"]["get"];

interface NoteData extends NonNullable<NoteOutput> {
  title: string;
  content: string | null;
  plainText: string | null;
  type: "note" | "journal" | "summary" | null;
  icon: string | null;
  cover: string | null;
  tags: string | null;
  folderId: string | null;
  shareToken: string | null;
  updatedAt: Date | null;
}

interface SaveOverrides {
  title?: string;
  cover?: string | null;
  folderId?: string | null;
}

function resolveCoverSource(cover: string | null | undefined) {
  const option = getNoteCoverOption(cover);
  return option?.src ?? cover ?? null;
}

function CoverPicker({
  currentCover,
  onSelect,
  className,
}: {
  currentCover: string | null;
  onSelect: (coverId: string) => void;
  className?: string;
}) {
  return (
    <div
      data-testid="note-cover-picker"
      className={cn(
        "absolute z-30 w-[320px] rounded-[22px] border border-stone-200/90 bg-white/96 p-3 shadow-[0_22px_64px_rgba(15,23,42,0.18)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/96",
        className
      )}
    >
      <div className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
        Built-in covers
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {NOTE_COVER_OPTIONS.map((option) => {
          const isSelected = currentCover === option.id;

          return (
            <button
              key={option.id}
              type="button"
              data-testid={`note-cover-option-${option.id}`}
              onClick={() => onSelect(option.id)}
              className="text-left"
            >
              <div
                className={cn(
                  "relative aspect-[8/5] overflow-hidden rounded-2xl border transition-all",
                  isSelected
                    ? "border-stone-900 ring-1 ring-stone-900 dark:border-stone-100 dark:ring-stone-100"
                    : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
                )}
              >
                <Image
                  src={option.src}
                  alt={option.label}
                  fill
                  sizes="144px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/6 via-transparent to-black/18" />
                {isSelected && (
                  <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/92 text-stone-900 shadow-sm dark:bg-stone-950/90 dark:text-stone-100">
                    <Check size={14} />
                  </span>
                )}
              </div>
              <div className="px-1 pb-1 pt-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                {option.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SharePopover({ noteId, shareToken }: { noteId: string; shareToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const enableShare = trpc.notes.enableShare.useMutation({
    onSuccess: () => utils.notes.get.invalidate({ id: noteId }),
  });
  const disableShare = trpc.notes.disableShare.useMutation({
    onSuccess: () => utils.notes.get.invalidate({ id: noteId }),
  });

  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`
    : null;

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="note-share-button"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors sm:px-3 sm:text-xs",
          shareToken
            ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/80 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60"
            : "border-stone-200 bg-white/80 text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-200"
        )}
      >
        <Share2 size={13} />
        {shareToken ? "Shared" : "Share"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[340px] rounded-2xl border border-stone-200/90 bg-white/96 p-4 shadow-[0_22px_64px_rgba(15,23,42,0.18)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/96">
          {shareToken ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                <Link size={14} className="text-blue-500" />
                Link sharing is on
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl ?? ""}
                  className="flex-1 truncate rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => { disableShare.mutate({ id: noteId }); setOpen(false); }}
                disabled={disableShare.isPending}
                className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/80 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
              >
                Disable sharing
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-stone-500 dark:text-stone-400">
                Anyone with the link can view this note (read-only).
              </div>
              <button
                type="button"
                onClick={() => enableShare.mutate({ id: noteId })}
                disabled={enableShare.isPending}
                className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                {enableShare.isPending ? "Enabling..." : "Enable link sharing"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteEditor({ id, note }: { id: string; note: NoteData }) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => utils.notes.get.invalidate({ id }),
  });

  const [title, setTitle] = useState(note.title);
  const [cover, setCover] = useState<string | null>(note.cover);
  const [folderId, setFolderId] = useState<string | null>(note.folderId ?? null);
  const [editorInstance, setEditorInstance] = useState<TiptapEditorInstance | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const { data: allFolders = [] } = trpc.folders.list.useQuery();

  // Build flat tree for folder picker with depth
  const folderPickerItems = (() => {
    type FItem = { id: string; name: string; parentId: string | null; depth: number };
    const items: FItem[] = [];
    const build = (parentId: string | null, depth: number) => {
      const children = allFolders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      for (const child of children) {
        items.push({ id: child.id, name: child.name, parentId: child.parentId, depth });
        build(child.id, depth + 1);
      }
    };
    build(null, 0);
    return items;
  })();

  // Click-outside to close folder picker
  useEffect(() => {
    if (!folderPickerOpen) return;
    const handler = (e: PointerEvent) => {
      if (folderPickerRef.current?.contains(e.target as Node)) return;
      setFolderPickerOpen(false);
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [folderPickerOpen]);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved"
  );
  const [lastEditedAt, setLastEditedAt] = useState<Date | null>(
    note.updatedAt ? new Date(note.updatedAt) : null
  );

  const contentRef = useRef({
    content: note.content ?? "",
    plainText: note.plainText ?? "",
  });
  const coverPickerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorInstanceRef = useRef<TiptapEditorInstance | null>(null);

  const doSave = useCallback(
    (overrides?: SaveOverrides) => {
      setSaveStatus("saving");
      updateNote.mutate(
        {
          id,
          title: overrides?.title ?? title,
          content: contentRef.current.content,
          plainText: contentRef.current.plainText,
          icon: note.icon,
          cover: overrides?.cover ?? cover,
          folderId: overrides?.folderId !== undefined ? overrides.folderId : folderId,
        },
        {
          onSuccess: () => {
            setSaveStatus("saved");
            setLastEditedAt(new Date());
          },
          onError: () => setSaveStatus("unsaved"),
        }
      );
    },
    [cover, folderId, id, note.icon, title, updateNote]
  );

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(), 1500);
  }, [doSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!isCoverPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (coverPickerRef.current?.contains(target)) return;
      setIsCoverPickerOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCoverPickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isCoverPickerOpen]);

  const handleContentChange = useCallback(
    (content: string, plainText: string) => {
      contentRef.current = { content, plainText };
      scheduleAutoSave();
    },
    [scheduleAutoSave]
  );

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave({ title: newTitle }), 1500);
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    const editor = editorInstanceRef.current;
    if (editor) {
      editor.commands.focus("start");
    }
  };

  const handleEditorReady = useCallback((editor: TiptapEditorInstance) => {
    editorInstanceRef.current = editor;
    setEditorInstance(editor);
  }, []);

  const handleFolderChange = (newFolderId: string | null) => {
    setFolderId(newFolderId);
    setFolderPickerOpen(false);
    doSave({ folderId: newFolderId });
  };

  const handleCoverChange = (nextCover: string | null) => {
    setCover(nextCover);
    doSave({ cover: nextCover });
  };

  const handleToggleCoverPicker = () => {
    setIsCoverPickerOpen((open) => !open);
  };

  const handleSelectCover = (nextCover: string) => {
    setIsCoverPickerOpen(false);

    if (nextCover === cover) return;
    handleCoverChange(nextCover);
  };

  const coverOption = getNoteCoverOption(cover);
  const coverSource = resolveCoverSource(cover);
  const hasCover = Boolean(coverSource);

  const statusDot = {
    saved: "bg-emerald-400",
    saving: "bg-amber-400 animate-pulse",
    unsaved: "bg-stone-300 dark:bg-stone-600",
  };

  return (
    <div className="-mx-4 -mt-5 w-auto pb-10 md:-mx-6 md:-mt-6">
      <div className="mx-auto mb-4 flex w-full max-w-[1360px] flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pt-5 md:px-10 md:pt-6">
        <button
          onClick={() => router.push("/notes")}
          data-testid="note-editor-back"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          <ArrowLeft size={16} />
          Back to notes
        </button>

        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
          {lastEditedAt && (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400 sm:px-3 sm:text-xs">
              Edited {formatDate(lastEditedAt)}
            </span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400 sm:gap-2 sm:px-3 sm:text-xs">
            <span className={cn("h-2 w-2 rounded-full", statusDot[saveStatus])} />
            {saveStatus === "saved"
              ? "Saved"
              : saveStatus === "saving"
                ? "Saving..."
                : "Editing"}
          </span>
          <SharePopover noteId={id} shareToken={note.shareToken} />
        </div>
      </div>

      {hasCover && (
        <div
          data-testid="note-cover-header"
          className="group relative mb-8 h-[280px] w-full overflow-hidden bg-stone-100 dark:bg-stone-900"
        >
          <Image
            src={coverSource ?? coverOption?.src ?? ""}
            alt={coverOption?.label ?? "Note cover"}
            fill
            unoptimized
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/12" />

          <div className="absolute inset-x-0 top-0 flex justify-end px-4 py-4 sm:px-6 sm:py-5 md:px-10">
            <div
              ref={coverPickerRef}
              className="relative flex items-center gap-2"
            >
              <div
                className={cn(
                  "flex items-center gap-2 transition-opacity",
                  isCoverPickerOpen
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                )}
              >
                <button
                  type="button"
                  onClick={handleToggleCoverPicker}
                  data-testid="note-add-cover"
                  className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/92 px-3.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm backdrop-blur transition-colors hover:bg-white dark:border-stone-700 dark:bg-stone-950/88 dark:text-stone-200 dark:hover:bg-stone-950"
                >
                  <ImagePlus size={14} />
                  Change cover
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsCoverPickerOpen(false);
                    handleCoverChange(null);
                  }}
                  data-testid="note-remove-cover"
                  className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/92 px-3.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm backdrop-blur transition-colors hover:bg-white dark:border-stone-700 dark:bg-stone-950/88 dark:text-stone-200 dark:hover:bg-stone-950"
                >
                  <X size={14} />
                  Remove cover
                </button>
              </div>

              {isCoverPickerOpen && (
                <CoverPicker
                  currentCover={cover}
                  onSelect={handleSelectCover}
                  className="right-0 top-full mt-3"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div
        data-testid="note-editor-shell"
        className="group/page-shell mx-auto w-full max-w-[980px] px-4 sm:px-6 md:px-10"
      >
        {!hasCover && (
          <div className="mb-3 flex items-center sm:px-1">
            <div
              ref={coverPickerRef}
              className={cn(
                "relative transition-opacity",
                isCoverPickerOpen
                  ? "opacity-100"
                  : "pointer-events-none opacity-0 group-hover/page-shell:pointer-events-auto group-hover/page-shell:opacity-100 group-focus-within/page-shell:pointer-events-auto group-focus-within/page-shell:opacity-100"
              )}
            >
              <button
                type="button"
                onClick={handleToggleCoverPicker}
                data-testid="note-add-cover"
                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
              >
                <ImagePlus size={14} />
                Add cover
              </button>

              {isCoverPickerOpen && (
                <CoverPicker
                  currentCover={cover}
                  onSelect={handleSelectCover}
                  className="left-0 top-full mt-3"
                />
              )}
            </div>
          </div>
        )}

        <div
          data-testid="page-properties"
          className="mb-3 flex flex-wrap items-center gap-3 text-sm text-stone-500 dark:text-stone-400 sm:px-1"
        >
          {/* Folder picker */}
          <div ref={folderPickerRef} className="relative">
            <button
              type="button"
              onClick={() => setFolderPickerOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                folderId
                  ? "border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                  : "border-dashed border-stone-300 text-stone-400 hover:border-stone-400 hover:text-stone-600 dark:border-stone-700 dark:text-stone-500 dark:hover:border-stone-600 dark:hover:text-stone-400"
              )}
            >
              <FolderOpen size={13} />
              {folderId
                ? allFolders.find((f) => f.id === folderId)?.name ?? "Folder"
                : "Add to folder"}
            </button>

            {folderPickerOpen && (
              <div className="absolute left-0 top-full z-40 mt-2 max-h-64 w-56 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                <button
                  type="button"
                  onClick={() => handleFolderChange(null)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                    folderId === null
                      ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                      : "text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800"
                  )}
                >
                  No folder
                </button>
                {folderPickerItems.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleFolderChange(f.id)}
                    className={cn(
                      "flex w-full items-center gap-2 py-1.5 text-sm transition-colors",
                      folderId === f.id
                        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                        : "text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800"
                    )}
                    style={{ paddingLeft: 12 + f.depth * 16 }}
                  >
                    <FolderOpen size={13} />
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {note.icon && (
          <div className={cn("mb-3 sm:px-1", hasCover && "-mt-14")}>
            <div className="inline-flex h-18 w-18 items-center justify-center rounded-[22px] border border-white/80 bg-white/95 text-4xl shadow-lg backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
              {note.icon}
            </div>
          </div>
        )}

        <div className="mb-5 mt-6 sm:mb-6 sm:mt-8 sm:px-1">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder="New page"
            rows={1}
            className="w-full resize-none border-none bg-transparent text-[3.15rem] font-semibold leading-[1.04] text-stone-900 outline-none placeholder:text-stone-300 dark:text-stone-100 dark:placeholder:text-stone-600 md:text-[3.5rem]"
            style={{ overflow: "hidden" }}
            onInput={(event) => {
              const target = event.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
        </div>

        <div className="-mx-1 sm:mx-0 sm:px-1">
          <TiptapEditor
            content={note.content ?? undefined}
            onChange={handleContentChange}
            onError={(message) => toast(message, "error")}
            onEditorReady={handleEditorReady}
            onFocusTitle={() => {
              const el = titleRef.current;
              if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
          />
        </div>

        <div className="sm:px-1">
          <BacklinksPanel noteId={id} />
        </div>
      </div>

      {/* TOC sidebar — fixed in the right margin, shown on large screens */}
      {editorInstance && (
        <div
          className="fixed bottom-4 top-24 hidden xl:flex"
          style={{
            right: "max(1.5rem, calc((100vw - 980px) / 2 - 14rem - 1rem))",
            width: "13rem",
          }}
        >
          <div className="w-full overflow-y-auto">
            <TocSidebar editor={editorInstance} />
          </div>
        </div>
      )}
    </div>
  );
}

export function NoteEditorPageClient({
  id,
  initialNote,
}: {
  id: string;
  initialNote: NoteOutput;
}) {
  const router = useRouter();
  const { data: note, isLoading } = trpc.notes.get.useQuery(
    { id },
    {
      initialData: initialNote ?? undefined,
      refetchOnMount: initialNote === null,
    }
  );

  if (isLoading && !note) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-200" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="py-12 text-center">
        <p className="text-stone-500 dark:text-stone-400">Note not found</p>
        <button
          onClick={() => router.push("/notes")}
          className="mt-4 text-blue-600 hover:underline"
        >
          Back to notes
        </button>
      </div>
    );
  }

  return <NoteEditor key={id} id={id} note={note} />;
}
