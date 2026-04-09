"use client";

import dynamic from "next/dynamic";
import { ExternalLink, FileText, Tag } from "lucide-react";
import { formatDate } from "@/lib/utils";

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

const NOTE_TYPE_LABELS: Record<string, string> = {
  analysis: "Source Analysis",
  followup: "Follow-up",
  manual: "Notes",
};

type SharedProjectNote = {
  title: string;
  content: string | null;
  tags: string | null;
  noteType: string | null;
  updatedAt: Date | null;
  projectName: string;
  projectRepoUrl: string | null;
  projectDescription: string | null;
  projectLanguage: string | null;
};

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];

  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

export function SharedProjectNoteView({
  note,
}: {
  note: SharedProjectNote | null;
}) {
  if (!note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-stone-950">
        <p className="text-lg text-stone-500 dark:text-stone-400">
          This project note is no longer shared or does not exist.
        </p>
      </div>
    );
  }

  const tags = parseTags(note.tags);
  const noteTypeLabel = NOTE_TYPE_LABELS[note.noteType ?? "manual"] ?? "Notes";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(248,250,252,0.98),rgba(241,245,249,1)_26%,rgba(255,255,255,1)_60%)] text-stone-900 dark:bg-[radial-gradient(circle_at_top,rgba(41,37,36,0.98),rgba(24,24,27,1)_26%,rgba(9,9,11,1)_60%)] dark:text-stone-100">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-12 pt-6 sm:gap-8 sm:px-6 sm:pb-16 sm:pt-10 md:px-10">
        <header
          data-testid="shared-project-note-hero"
          className="border border-transparent bg-transparent p-0 shadow-none sm:rounded-[32px] sm:border-stone-200/80 sm:bg-white/85 sm:p-8 sm:shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:backdrop-blur sm:dark:border-stone-800 sm:dark:bg-stone-950/80"
        >
          <div className="space-y-3 sm:space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-900/80 dark:bg-blue-950/60 dark:text-blue-200">
              <FileText size={14} />
              Shared project note
            </div>
            <div className="space-y-2">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                From project
              </p>
              <h1 className="text-[2.35rem] font-semibold leading-[1.02] tracking-tight sm:text-4xl md:text-5xl">
                {note.projectName}
              </h1>
              <p className="max-w-2xl text-[15px] leading-7 text-stone-600 dark:text-stone-300 sm:text-base">
                {note.projectDescription || "No description yet."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
              {note.projectLanguage ? (
                <span className="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-900">
                  {note.projectLanguage}
                </span>
              ) : null}
              {note.projectRepoUrl ? (
                <a
                  href={note.projectRepoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink size={14} />
                  {note.projectRepoUrl}
                </a>
              ) : null}
            </div>
          </div>
        </header>

        <article
          data-testid="shared-project-note-body"
          className="border border-transparent bg-transparent p-0 shadow-none sm:rounded-[28px] sm:border-stone-200/80 sm:bg-white/90 sm:p-6 sm:shadow-[0_12px_40px_rgba(15,23,42,0.06)] sm:backdrop-blur sm:dark:border-stone-800 sm:dark:bg-stone-950/85"
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4 sm:mb-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                  {noteTypeLabel}
                </span>
                {note.updatedAt ? (
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    Updated {formatDate(note.updatedAt)}
                  </span>
                ) : null}
              </div>
              <h2 className="text-[2rem] font-semibold leading-[1.08] text-stone-900 dark:text-stone-100 sm:text-3xl">
                {note.title || "Untitled note"}
              </h2>
            </div>

            {tags.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-900/80 dark:bg-blue-950/50 dark:text-blue-200"
                  >
                    <Tag size={11} />
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="prose-shared">
            <TiptapEditor content={note.content ?? undefined} editable={false} />
          </div>
        </article>

        <footer className="pt-2 text-left text-xs text-stone-400 dark:text-stone-500 sm:pt-4 sm:text-center">
          Built with Second Brain
        </footer>
      </div>
    </div>
  );
}
