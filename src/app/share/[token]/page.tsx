"use client";

import { use } from "react";
import Image from "next/image";
import { Tag } from "lucide-react";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc";
import { getNoteCoverOption } from "@/lib/note-appearance";

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

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

function SharedNoteView({ token }: { token: string }) {
  const { data: note, isLoading } = trpc.notes.getShared.useQuery({ token });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-stone-950">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-200" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-stone-950">
        <p className="text-lg text-stone-500 dark:text-stone-400">
          This note is no longer shared or does not exist.
        </p>
      </div>
    );
  }

  const coverOption = getNoteCoverOption(note.cover);
  const coverSource = coverOption?.src ?? note.cover ?? null;
  const tags = parseTags(note.tags);

  return (
    <div className="min-h-screen bg-white dark:bg-stone-950">
      {coverSource && (
        <div className="relative h-[280px] w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
          <Image
            src={coverSource}
            alt="Note cover"
            fill
            unoptimized
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/12" />
        </div>
      )}

      <article className="mx-auto w-full max-w-[780px] px-6 pb-20 pt-10 md:px-10">
        {note.icon && (
          <div className={coverSource ? "-mt-14 mb-3" : "mb-3"}>
            <div className="inline-flex h-18 w-18 items-center justify-center rounded-[22px] border border-white/80 bg-white/95 text-4xl shadow-lg backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
              {note.icon}
            </div>
          </div>
        )}

        <h1 className="mb-4 text-[3.15rem] font-semibold leading-[1.04] text-stone-900 dark:text-stone-100 md:text-[3.5rem]">
          {note.title}
        </h1>

        {tags.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm text-blue-700 dark:border-blue-900/80 dark:bg-blue-950/50 dark:text-blue-200"
              >
                <Tag size={12} />
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="prose-shared">
          <TiptapEditor
            content={note.content ?? undefined}
            editable={false}
          />
        </div>

        <footer className="mt-16 border-t border-stone-200 pt-6 text-center text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
          Built with Second Brain
        </footer>
      </article>
    </div>
  );
}

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  return <SharedNoteView token={token} />;
}
