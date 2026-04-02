"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const [selectedTag, setSelectedTag] = useState<string | undefined>();

  const { data: project, isLoading: projectLoading } =
    trpc.ossProjects.getProject.useQuery({ id });
  const { data: notes = [], isLoading: notesLoading } =
    trpc.ossProjects.listNotes.useQuery({ projectId: id, tag: selectedTag });
  const createNote = trpc.ossProjects.createNote.useMutation({
    onSuccess: async (data) => {
      await utils.ossProjects.listNotes.invalidate({ projectId: id });
      router.push(`/projects/${id}/notes/${data.id}`);
    },
  });

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const note of notes) {
      if (!note.tags) continue;
      try {
        for (const tag of JSON.parse(note.tags) as string[]) {
          if (typeof tag === "string") set.add(tag);
        }
      } catch {
        continue;
      }
    }
    return [...set];
  }, [notes]);

  if (projectLoading) {
    return <div className="py-12 text-sm text-stone-500">Loading project...</div>;
  }

  if (!project) {
    return <div className="py-12 text-center text-stone-500">Project not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900 dark:text-stone-100">
            {project.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-500 dark:text-stone-400">
            {project.description || "No description yet."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
            {project.language && (
              <span className="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-900">
                {project.language}
              </span>
            )}
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                {project.repoUrl}
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => createNote.mutate({ projectId: id, title: "" })}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={16} />
          Add note
        </button>
      </div>

      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag((current) => (current === tag ? undefined : tag))}
              className={`rounded-full px-2.5 py-1 text-xs ${
                selectedTag === tag
                  ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950"
                  : "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {notesLoading ? (
        <div className="py-12 text-sm text-stone-500">Loading notes...</div>
      ) : notes.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/70 px-6 py-14 text-center text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
          No project notes yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => router.push(`/projects/${id}/notes/${note.id}`)}
              className="w-full rounded-[24px] border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-medium text-stone-900 dark:text-stone-100">
                    {note.title || "New page"}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                    {note.plainText || "Empty note"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-stone-400">
                  {formatDate(note.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
