"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { KnowledgeNoteEditor } from "@/components/editor/knowledge-note-editor";
import { trpc } from "@/lib/trpc";

function MarkdownViewer({ content, backHref, backLabel, title }: {
  content: string;
  backHref: string;
  backLabel: string;
  title: string;
}) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => router.push(backHref)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
      >
        <ArrowLeft size={14} />
        {backLabel}
      </button>
      <h1 className="mb-6 text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {title}
      </h1>
      <article className="prose prose-stone max-w-none dark:prose-invert">
        <pre className="whitespace-pre-wrap border-none bg-transparent p-0 font-sans text-sm leading-relaxed">
          {content}
        </pre>
      </article>
    </div>
  );
}

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
          onClick={() => router.push(`/projects/${id}`)}
          className="mt-4 text-blue-600 hover:underline"
        >
          Back to project
        </button>
      </div>
    );
  }

  // Analysis/followup notes are plain Markdown — render directly
  const noteType = (note as { noteType?: string }).noteType;
  if (noteType === "analysis" || noteType === "followup") {
    return (
      <MarkdownViewer
        content={note.plainText ?? ""}
        backHref={`/projects/${id}`}
        backLabel="Back to project"
        title={note.title}
      />
    );
  }

  return (
    <KnowledgeNoteEditor
      noteId={noteId}
      note={note}
      backHref={`/projects/${id}`}
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
