"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";

const TiptapEditor = dynamic(
  () =>
    import("@/components/editor/tiptap-editor").then((m) => m.TiptapEditor),
  { ssr: false }
);

export function LearnNewNoteClient({ topicId }: { topicId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const editRef = useRef<{ content: string; plainText: string }>({
    content: "",
    plainText: "",
  });

  const { data: topic } = trpc.learningNotebook.getTopic.useQuery({
    id: topicId,
  });

  const createNote = trpc.learningNotebook.createNote.useMutation({
    onSuccess: ({ id }) => {
      utils.learningNotebook.listNotes.invalidate({ topicId });
      utils.learningNotebook.listTopics.invalidate();
      toast("Card created", "success");
      router.push(`/learn/${topicId}/${id}`);
    },
    onError: (err) => toast(err.message ?? "Failed to create card", "error"),
  });

  const onSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast("Please enter a title", "error");
      return;
    }
    const tags = tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    createNote.mutate({
      topicId,
      title: trimmedTitle,
      content: editRef.current.content,
      plainText: editRef.current.plainText,
      tags: JSON.stringify(tags),
    });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <div className="mb-4">
        <Link
          href={`/learn/${topicId}`}
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {topic?.title ?? "topic"}
        </Link>
      </div>

      <div className="mb-3">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Card title (e.g. What is React Fiber?)"
          className="w-full bg-transparent text-2xl font-semibold text-stone-900 outline-none placeholder:text-stone-300 dark:text-stone-100 dark:placeholder:text-stone-700"
          data-testid="new-card-title"
        />
      </div>

      <div className="mb-4">
        <input
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
          placeholder="Tags, comma-separated"
          className="w-full bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400 dark:text-stone-200 dark:placeholder:text-stone-600"
        />
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-stone-200 p-4 dark:border-stone-800">
        <TiptapEditor
          content=""
          editable
          placeholder="Type / for commands..."
          onChange={(content, plainText) => {
            editRef.current.content = content;
            editRef.current.plainText = plainText;
          }}
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Link
          href={`/learn/${topicId}`}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={onSubmit}
          disabled={createNote.isPending || !title.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          data-testid="new-card-save"
        >
          {createNote.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
