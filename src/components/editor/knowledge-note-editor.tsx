"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { cn, formatDate } from "@/lib/utils";

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

  const doSave = useCallback(
    async (overrides?: { title?: string; tags?: string[] }) => {
      setSaveStatus("saving");

      try {
        await onSave({
          id: noteId,
          title: overrides?.title ?? title,
          content: contentRef.current.content,
          plainText: contentRef.current.plainText,
          tags: JSON.stringify(overrides?.tags ?? tags),
        });
        setSaveStatus("saved");
        setLastEditedAt(new Date());
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [noteId, onSave, tags, title]
  );

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSave();
    }, 1500);
  }, [doSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

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
          onClick={() => router.push(backHref)}
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

        <TiptapEditor
          content={note.content ?? undefined}
          placeholder={emptyMessage}
          onChange={(content, plainText) => {
            contentRef.current = { content, plainText };
            scheduleAutoSave();
          }}
        />
      </div>
    </div>
  );
}
