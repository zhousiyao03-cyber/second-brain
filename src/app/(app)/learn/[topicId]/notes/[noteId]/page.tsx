"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { KnowledgeNoteEditor } from "@/components/editor/knowledge-note-editor";
import { trpc } from "@/lib/trpc";

export default function LearningNotePage({
  params,
}: {
  params: Promise<{ topicId: string; noteId: string }>;
}) {
  const { topicId, noteId } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: note, isLoading } = trpc.learningNotebook.getNote.useQuery({
    id: noteId,
  });
  const updateNote = trpc.learningNotebook.updateNote.useMutation();

  if (isLoading) {
    return <div className="py-12 text-sm text-stone-500">Loading note...</div>;
  }

  if (!note) {
    return (
      <div className="py-12 text-center text-stone-500">
        <p>Note not found.</p>
        <button
          type="button"
          onClick={() => router.push(`/learn/${topicId}`)}
          className="mt-4 text-blue-600 hover:underline"
        >
          Back to topic
        </button>
      </div>
    );
  }

  return (
    <KnowledgeNoteEditor
      noteId={noteId}
      note={note}
      backHref={`/learn/${topicId}`}
      backLabel="Back to topic"
      onSave={async (payload) => {
        await updateNote.mutateAsync({
          id: payload.id,
          topicId,
          title: payload.title,
          content: payload.content,
          plainText: payload.plainText,
          tags: payload.tags,
        });
        await Promise.all([
          utils.learningNotebook.getNote.invalidate({ id: noteId }),
          utils.learningNotebook.getTopic.invalidate({ id: topicId }),
          utils.learningNotebook.listNotes.invalidate({ topicId }),
        ]);
      }}
    />
  );
}
