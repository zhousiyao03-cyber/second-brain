"use client";

import { use, useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { ArrowLeft, Tag, X, MoreHorizontal } from "lucide-react";

interface NoteData {
  title: string;
  content: string | null;
  plainText: string | null;
  type: string | null;
  tags: string | null;
}

function NoteEditor({ id, note }: { id: string; note: NoteData }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const updateNote = trpc.notes.update.useMutation({
    onSuccess: () => utils.notes.get.invalidate({ id }),
  });

  const [title, setTitle] = useState(note.title);
  const [type, setType] = useState<"note" | "journal" | "summary">(
    (note.type as "note" | "journal" | "summary") ?? "note"
  );
  const [tags, setTags] = useState<string[]>(
    note.tags ? JSON.parse(note.tags) : []
  );
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved"
  );
  const [showMeta, setShowMeta] = useState(false);

  const contentRef = useRef({
    content: note.content ?? "",
    plainText: note.plainText ?? "",
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSave = useCallback(
    (overrides?: { title?: string; type?: string; tags?: string[] }) => {
      setSaveStatus("saving");
      updateNote.mutate(
        {
          id,
          title: overrides?.title ?? title,
          content: contentRef.current.content,
          plainText: contentRef.current.plainText,
          type: (overrides?.type ?? type) as "note" | "journal" | "summary",
          tags: JSON.stringify(overrides?.tags ?? tags),
        },
        {
          onSuccess: () => setSaveStatus("saved"),
          onError: () => setSaveStatus("unsaved"),
        }
      );
    },
    [id, title, type, tags, updateNote]
  );

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(), 1500);
  }, [doSave]);

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

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Focus the editor below
      const editorEl = document.querySelector(".notion-editor") as HTMLElement;
      editorEl?.focus();
    }
  };

  const handleTypeChange = (newType: "note" | "journal" | "summary") => {
    setType(newType);
    doSave({ type: newType });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      setTagInput("");
      doSave({ tags: newTags });
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const newTags = tags.filter((t) => t !== tagToRemove);
    setTags(newTags);
    doSave({ tags: newTags });
  };

  const typeLabels: Record<string, string> = {
    note: "笔记",
    journal: "日记",
    summary: "总结",
  };

  const statusDot = {
    saved: "bg-green-400",
    saving: "bg-yellow-400 animate-pulse",
    unsaved: "bg-gray-300",
  };

  return (
    <div className="max-w-3xl mx-auto py-4">
      {/* Top bar — minimal */}
      <div className="flex items-center justify-between mb-6 px-1">
        <button
          onClick={() => router.push("/notes")}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">返回</span>
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${statusDot[saveStatus]}`} />
            <span className="text-xs text-gray-400">
              {saveStatus === "saved"
                ? "已保存"
                : saveStatus === "saving"
                ? "保存中..."
                : "编辑中"}
            </span>
          </div>
          <button
            onClick={() => setShowMeta((v) => !v)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="笔记属性"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Collapsible metadata */}
      {showMeta && (
        <div className="mb-4 px-1 py-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 px-3">
            <span className="text-xs text-gray-500 w-12 shrink-0">类型</span>
            <div className="flex gap-1.5">
              {(["note", "journal", "summary"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    type === t
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  {typeLabels[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 px-3">
            <span className="text-xs text-gray-500 w-12 shrink-0">
              <Tag size={12} className="inline" /> 标签
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-white text-gray-700 rounded-md border border-gray-200"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-500 transition-colors"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="添加标签..."
                className="text-xs border-none outline-none bg-transparent placeholder-gray-400 w-20"
              />
            </div>
          </div>
        </div>
      )}

      {/* Title — large, Notion-style */}
      <div className="px-1 mb-1">
        <textarea
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          placeholder="无标题"
          rows={1}
          className="w-full text-4xl font-bold text-gray-900 dark:text-gray-100 border-none outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 resize-none leading-tight"
          style={{ overflow: "hidden" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = target.scrollHeight + "px";
          }}
        />
      </div>

      {/* Editor */}
      <div className="px-1">
        <TiptapEditor
          content={note.content ?? undefined}
          onChange={handleContentChange}
        />
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
      <div className="max-w-3xl mx-auto py-20 text-center">
        <div className="inline-block w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">笔记不存在</p>
        <button
          onClick={() => router.push("/notes")}
          className="mt-4 text-blue-600 hover:underline"
        >
          返回笔记列表
        </button>
      </div>
    );
  }

  return <NoteEditor id={id} note={note} />;
}
