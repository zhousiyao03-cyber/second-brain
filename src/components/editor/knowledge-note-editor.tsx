"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Tag, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { TocSidebar } from "@/components/editor/toc-sidebar";
import { cn, formatDate } from "@/lib/utils";

const DRAFT_PREFIX = "note-draft:";

function getDraftKey(noteId: string) {
  return `${DRAFT_PREFIX}${noteId}`;
}

interface DraftData {
  title: string;
  content: string;
  plainText: string;
  tags: string;
  savedAt: number;
}

function saveDraftToLocal(noteId: string, draft: DraftData) {
  try {
    localStorage.setItem(getDraftKey(noteId), JSON.stringify(draft));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function loadDraftFromLocal(noteId: string): DraftData | null {
  try {
    const raw = localStorage.getItem(getDraftKey(noteId));
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

function clearDraftFromLocal(noteId: string) {
  try {
    localStorage.removeItem(getDraftKey(noteId));
  } catch {
    // ignore
  }
}

export interface KnowledgeNoteData {
  title: string;
  content: string | null;
  plainText: string | null;
  tags: string | null;
  updatedAt: Date | null;
}

interface KnowledgeNoteEditorProps {
  noteId: string;
  note: KnowledgeNoteData;
  backHref: string;
  backLabel: string;
  emptyMessage?: string;
  onSave: (payload: {
    id: string;
    title: string;
    content: string;
    plainText: string;
    tags: string;
  }) => Promise<void>;
}

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

export function KnowledgeNoteEditor({
  noteId,
  note,
  backHref,
  backLabel,
  emptyMessage = "Start typing...",
  onSave,
}: KnowledgeNoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState<string[]>(parseTags(note.tags));
  const [tagInput, setTagInput] = useState("");
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveStatusRef = useRef<"saved" | "saving" | "unsaved">("saved");
  const titleRef = useRef(note.title);
  const tagsRef = useRef<string[]>(parseTags(note.tags));
  const [draftRecovery, setDraftRecovery] = useState<DraftData | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);

  // Keep refs in sync with state
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);

  // Check for recoverable draft on mount
  useEffect(() => {
    const draft = loadDraftFromLocal(noteId);
    if (draft && draft.savedAt > (note.updatedAt?.getTime() ?? 0)) {
      setDraftRecovery(draft);
    } else {
      clearDraftFromLocal(noteId);
    }
  }, [noteId, note.updatedAt]);

  const doSave = useCallback(
    async (overrides?: { title?: string; tags?: string[] }) => {
      setSaveStatus("saving");
      saveStatusRef.current = "saving";

      try {
        await onSave({
          id: noteId,
          title: overrides?.title ?? titleRef.current,
          content: contentRef.current.content,
          plainText: contentRef.current.plainText,
          tags: JSON.stringify(overrides?.tags ?? tagsRef.current),
        });
        setSaveStatus("saved");
        saveStatusRef.current = "saved";
        setLastEditedAt(new Date());
        clearDraftFromLocal(noteId);
      } catch {
        setSaveStatus("unsaved");
        saveStatusRef.current = "unsaved";
      }
    },
    [noteId, onSave]
  );

  /** Save local draft to localStorage for crash recovery */
  const saveDraft = useCallback(() => {
    saveDraftToLocal(noteId, {
      title: titleRef.current,
      content: contentRef.current.content,
      plainText: contentRef.current.plainText,
      tags: JSON.stringify(tagsRef.current),
      savedAt: Date.now(),
    });
  }, [noteId]);

  /** Flush any pending save immediately (for beforeunload / route change) */
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    if (saveStatusRef.current !== "saved") {
      // Save draft to localStorage as a guaranteed fallback
      saveDraft();
      // Also fire the network save (best-effort, may not complete on unload)
      void doSave();
    }
  }, [doSave, saveDraft]);

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus("unsaved");
    saveStatusRef.current = "unsaved";
    // Save draft to localStorage immediately for crash safety
    saveDraft();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSave();
    }, 1500);
  }, [doSave, saveDraft]);

  // beforeunload: warn user and flush save
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatusRef.current !== "saved") {
        flushSave();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushSave]);

  // Flush on unmount (route change within SPA)
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (saveStatusRef.current !== "saved") {
        saveDraft();
        // Use sendBeacon-style keepalive fetch as best-effort
        void doSave();
      }
    },
    [doSave, saveDraft]
  );

  const handleRecoverDraft = useCallback(() => {
    if (!draftRecovery) return;
    setTitle(draftRecovery.title);
    contentRef.current = {
      content: draftRecovery.content,
      plainText: draftRecovery.plainText,
    };
    try {
      setTags(JSON.parse(draftRecovery.tags) as string[]);
    } catch { /* ignore */ }
    setDraftRecovery(null);
    clearDraftFromLocal(noteId);
    // Trigger save with recovered data
    void doSave({ title: draftRecovery.title });
  }, [draftRecovery, noteId, doSave]);

  const handleDismissRecovery = useCallback(() => {
    setDraftRecovery(null);
    clearDraftFromLocal(noteId);
  }, [noteId]);

  const handleAddTag = () => {
    const nextTag = tagInput.trim();
    if (!nextTag || tags.includes(nextTag)) return;

    const nextTags = [...tags, nextTag];
    setTags(nextTags);
    setTagInput("");
    void doSave({ tags: nextTags });
  };

  const handleRemoveTag = (targetTag: string) => {
    const nextTags = tags.filter((tag) => tag !== targetTag);
    setTags(nextTags);
    void doSave({ tags: nextTags });
  };

  return (
    <div className="-mx-4 -mt-5 w-auto pb-10 md:-mx-6 md:-mt-6">
      <div className="mx-auto mb-4 flex w-full max-w-[980px] items-center justify-between gap-4 px-6 pt-5 md:px-10 md:pt-6">
        <button
          onClick={() => {
            flushSave();
            router.push(backHref);
          }}
          data-testid="note-editor-back"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </button>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {lastEditedAt && (
            <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400">
              Edited {formatDate(lastEditedAt)}
            </span>
          )}
          <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                saveStatus === "saved"
                  ? "bg-emerald-400"
                  : saveStatus === "saving"
                    ? "animate-pulse bg-amber-400"
                    : "bg-stone-300 dark:bg-stone-600"
              )}
            />
            {saveStatus === "saved"
              ? "Saved"
              : saveStatus === "saving"
                ? "Saving..."
                : "Editing"}
          </span>
        </div>
      </div>

      {draftRecovery && (
        <div className="mx-auto mb-4 flex w-full max-w-[980px] items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30 md:px-10">
          <RotateCcw size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-amber-800 dark:text-amber-200">
            Found unsaved draft from {formatDate(new Date(draftRecovery.savedAt))}
          </span>
          <button
            type="button"
            onClick={handleRecoverDraft}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
          >
            Recover
          </button>
          <button
            type="button"
            onClick={handleDismissRecovery}
            className="rounded-lg px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-[980px] px-6 md:px-10">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm text-blue-700 dark:border-blue-900/80 dark:bg-blue-950/50 dark:text-blue-200"
            >
              <Tag size={12} />
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => handleRemoveTag(tag)}
                className="rounded-full px-1 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/70 dark:hover:text-blue-100"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            data-testid="note-tag-input"
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              handleAddTag();
            }}
            onBlur={() => {
              if (tagInput.trim()) handleAddTag();
            }}
            placeholder="Add tag..."
            className="min-w-28 rounded-full border border-dashed border-stone-200 bg-transparent px-3 py-1 text-sm text-stone-600 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-300 dark:border-stone-700 dark:text-stone-300 dark:placeholder:text-stone-500 dark:focus:border-stone-600"
          />
        </div>

        <div className="mb-6">
          <textarea
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              setSaveStatus("unsaved");
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(() => {
                void doSave({ title: nextTitle });
              }, 1500);
            }}
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

        <div className="flex gap-6">
          <div className="hidden lg:block">
            <TocSidebar editor={editorInstance} />
          </div>
          <div className="min-w-0 flex-1">
            <TiptapEditor
              content={note.content ?? undefined}
              placeholder={emptyMessage}
              onEditorReady={setEditorInstance}
              onChange={(content, plainText) => {
                contentRef.current = { content, plainText };
                scheduleAutoSave();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
