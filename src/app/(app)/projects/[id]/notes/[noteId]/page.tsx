"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { KnowledgeNoteEditor } from "@/components/editor/knowledge-note-editor";
import { trpc } from "@/lib/trpc";

export default function ProjectNotePage({
  params,
}: {
  params: Promise<{ id: string; noteId: string }>;
}) {
  const { id, noteId } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: note, isLoading } = trpc.ossProjects.getNote.useQuery({ id: noteId });
  const updateNote = trpc.ossProjects.updateNote.useMutation();

  if (isLoading) {
    return <div className="py-12 text-sm text-stone-500">Loading note...</div>;
  }

  if (!note) {
    return (
      <div className="py-12 text-center text-stone-500">
        <p>Note not found.</p>
        <button
          type="button"
          onClick={() => router.push(`/projects/${id}?view=overview`)}
          className="mt-4 text-blue-600 hover:underline"
        >
          Back to project
        </button>
      </div>
    );
  }

  return (
    <KnowledgeNoteEditor
      noteId={noteId}
      note={note}
      backHref={`/projects/${id}?view=overview`}
      backLabel="Back to project"
      onSave={async (payload) => {
        await updateNote.mutateAsync({
          id: payload.id,
          projectId: id,
          title: payload.title,
          content: payload.content,
          plainText: payload.plainText,
          tags: payload.tags,
        });
        await Promise.all([
          utils.ossProjects.getNote.invalidate({ id: noteId }),
          utils.ossProjects.getProject.invalidate({ id }),
          utils.ossProjects.listNotes.invalidate({ projectId: id }),
        ]);
      }}
    />
  );
}
