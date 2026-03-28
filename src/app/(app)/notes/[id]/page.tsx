"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ImagePlus, Tag, X } from "lucide-react";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { cn, formatDate } from "@/lib/utils";
import {
  NOTE_COVER_OPTIONS,
  NOTE_TYPE_LABELS,
  getNoteCoverOption,
} from "@/lib/note-appearance";

interface NoteData {
  title: string;
  content: string | null;
  plainText: string | null;
  type: "note" | "journal" | "summary" | null;
  icon: string | null;
  cover: string | null;
  tags: string | null;
  updatedAt: Date | null;
}

interface SaveOverrides {
  title?: string;
  type?: "note" | "journal" | "summary";
  tags?: string[];
  cover?: string | null;
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
        内置背景
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

function NoteEditor({ id, note }: { id: string; note: NoteData }) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => utils.notes.get.invalidate({ id }),
  });

  const [title, setTitle] = useState(note.title);
  const [type, setType] = useState<"note" | "journal" | "summary">(
    note.type ?? "note"
  );
  const [cover, setCover] = useState<string | null>(note.cover);
  const [tags, setTags] = useState<string[]>(parseTags(note.tags));
  const [tagInput, setTagInput] = useState("");
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

  const doSave = useCallback(
    (overrides?: SaveOverrides) => {
      setSaveStatus("saving");
      updateNote.mutate(
        {
          id,
          title: overrides?.title ?? title,
          content: contentRef.current.content,
          plainText: contentRef.current.plainText,
          type: overrides?.type ?? type,
          icon: note.icon,
          cover: overrides?.cover ?? cover,
          tags: JSON.stringify(overrides?.tags ?? tags),
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
    [cover, id, note.icon, tags, title, type, updateNote]
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
    const editorEl = document.querySelector(".notion-editor") as HTMLElement | null;
    editorEl?.focus();
  };

  const handleTypeChange = (newType: "note" | "journal" | "summary") => {
    setType(newType);
    doSave({ type: newType });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag || tags.includes(tag)) return;

    const newTags = [...tags, tag];
    setTags(newTags);
    setTagInput("");
    doSave({ tags: newTags });
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    doSave({ tags: newTags });
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
      <div className="mx-auto mb-4 flex w-full max-w-[1360px] items-center justify-between gap-4 px-6 pt-5 md:px-10 md:pt-6">
        <button
          onClick={() => router.push("/notes")}
          data-testid="note-editor-back"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          <ArrowLeft size={16} />
          返回笔记
        </button>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {lastEditedAt && (
            <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400">
              编辑于 {formatDate(lastEditedAt)}
            </span>
          )}
          <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-400">
            <span className={cn("h-2 w-2 rounded-full", statusDot[saveStatus])} />
            {saveStatus === "saved"
              ? "已保存"
              : saveStatus === "saving"
                ? "保存中..."
                : "正在编辑"}
          </span>
        </div>
      </div>

      {hasCover && (
        <div
          data-testid="note-cover-header"
          className="group relative mb-8 h-[280px] w-full overflow-hidden bg-stone-100 dark:bg-stone-900"
        >
          <Image
            src={coverSource ?? coverOption?.src ?? ""}
            alt={coverOption?.label ?? "笔记封面"}
            fill
            unoptimized
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/12" />

          <div className="absolute inset-x-0 top-0 flex justify-end px-6 py-5 md:px-10">
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
                  更改封面
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
                  移除封面
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

      <div className="group/page-shell mx-auto w-full max-w-[980px] px-6 md:px-10">
        {!hasCover && (
          <div className="mb-3 flex items-center px-1">
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
                添加封面
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
          className="mb-3 flex flex-wrap items-center gap-3 px-1 text-sm text-stone-500 dark:text-stone-400"
        >
          <div className="flex flex-wrap items-center gap-2">
            {(Object.entries(NOTE_TYPE_LABELS) as Array<
              [keyof typeof NOTE_TYPE_LABELS, string]
            >).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleTypeChange(value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  type === value
                    ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:border-stone-700 dark:hover:text-stone-100"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="hidden h-4 w-px bg-stone-200 dark:bg-stone-800 md:block" />

          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm text-blue-700 dark:border-blue-900/80 dark:bg-blue-950/50 dark:text-blue-200"
              >
                <Tag size={12} />
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="rounded-full px-1 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/70 dark:hover:text-blue-100"
                  aria-label={`移除标签 ${tag}`}
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
              placeholder="添加标签..."
              className="min-w-28 rounded-full border border-dashed border-stone-200 bg-transparent px-3 py-1 text-sm text-stone-600 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-300 dark:border-stone-700 dark:text-stone-300 dark:placeholder:text-stone-500 dark:focus:border-stone-600"
            />
          </div>
        </div>

        {note.icon && (
          <div className={cn("mb-3 px-1", hasCover && "-mt-14")}>
            <div className="inline-flex h-18 w-18 items-center justify-center rounded-[22px] border border-white/80 bg-white/95 text-4xl shadow-lg backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
              {note.icon}
            </div>
          </div>
        )}

        <div className="mt-8 mb-6 px-1">
          <textarea
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder="新页面"
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

        <div className="px-1">
          <TiptapEditor
            content={note.content ?? undefined}
            onChange={handleContentChange}
            onError={(message) => toast(message, "error")}
          />
        </div>
      </div>
    </div>
  );
}

export default function NoteEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: note, isLoading } = trpc.notes.get.useQuery({ id });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-200" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="py-12 text-center">
        <p className="text-stone-500 dark:text-stone-400">笔记不存在</p>
        <button
          onClick={() => router.push("/notes")}
          className="mt-4 text-blue-600 hover:underline"
        >
          返回笔记列表
        </button>
      </div>
    );
  }

  return <NoteEditor key={id} id={id} note={note} />;
}
