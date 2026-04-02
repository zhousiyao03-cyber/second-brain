"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Brain,
  ChevronDown,
  Loader2,
  MessageCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

function parseReviewContent(content: string) {
  try {
    return JSON.parse(content) as {
      title: string;
      summary: string;
      items: Array<{ heading: string; detail: string }>;
    };
  } catch {
    return null;
  }
}

export default function LearningTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<"notes" | "ai">("notes");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const { data: topic, isLoading: topicLoading } =
    trpc.learningNotebook.getTopic.useQuery({ id: topicId });
  const { data: notes = [], isLoading: notesLoading } =
    trpc.learningNotebook.listNotes.useQuery({
      topicId,
      search: search || undefined,
      tag: selectedTag,
    });
  const { data: reviews = [] } = trpc.learningNotebook.listReviews.useQuery({
    topicId,
  });

  const createNote = trpc.learningNotebook.createNote.useMutation({
    onSuccess: async (data) => {
      await utils.learningNotebook.listNotes.invalidate({ topicId });
      router.push(`/learn/${topicId}/notes/${data.id}`);
    },
  });
  const generateReview = trpc.learningNotebook.generateReview.useMutation({
    onSuccess: async () => {
      await utils.learningNotebook.listReviews.invalidate({ topicId });
      setActiveTab("ai");
    },
  });
  const ask = trpc.learningNotebook.ask.useMutation({
    onSuccess: (data) => setAnswer(data.answer),
  });

  const allTags = useMemo(() => {
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

  if (topicLoading) {
    return <div className="py-12 text-sm text-stone-500">Loading topic...</div>;
  }

  if (!topic) {
    return (
      <div className="py-12 text-center text-stone-500">
        Topic not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-3xl dark:bg-stone-900">
            {topic.icon || "📘"}
          </div>
          <h1 className="text-3xl font-semibold text-stone-900 dark:text-stone-100">
            {topic.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-500 dark:text-stone-400">
            {topic.description || "No description yet."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {topic.topTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setSelectedTag((current) => (current === tag ? undefined : tag));
                  setActiveTab("notes");
                }}
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
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-right shadow-sm dark:border-stone-800 dark:bg-stone-950">
          <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {topic.noteCount}
          </div>
          <div className="text-xs uppercase tracking-[0.16em] text-stone-400">
            {topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setActiveTab("notes")}
          className={`rounded-full px-4 py-2 text-sm ${
            activeTab === "notes"
              ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950"
              : "text-stone-500"
          }`}
        >
          Notes
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`rounded-full px-4 py-2 text-sm ${
            activeTab === "ai"
              ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950"
              : "text-stone-500"
          }`}
        >
          AI assistant
        </button>
      </div>

      {activeTab === "notes" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search notes..."
              className="min-w-[240px] flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-stone-700 dark:bg-stone-950"
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setComposerOpen((open) => !open)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus size={16} />
                New note
                <ChevronDown size={14} />
              </button>
              {composerOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-10 mt-2 w-52 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl dark:border-stone-800 dark:bg-stone-950"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setComposerOpen(false);
                      createNote.mutate({ topicId, title: "" });
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-900"
                  >
                    <BookOpen size={15} />
                    Blank note
                  </button>
                  <div className="mt-2 rounded-xl bg-stone-50 p-2 dark:bg-stone-900">
                    <button
                      type="button"
                      role="menuitem"
                      className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-stone-700 dark:text-stone-200"
                    >
                      <Sparkles size={15} />
                      AI draft
                    </button>
                    <input
                      value={draftKeyword}
                      onChange={(event) => setDraftKeyword(event.target.value)}
                      placeholder="e.g. goroutines"
                      className="mb-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-stone-700 dark:bg-stone-950"
                    />
                    <button
                      type="button"
                      disabled={!draftKeyword.trim()}
                      onClick={async () => {
                        const response = await fetch("/api/learn/draft", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ topicId, keyword: draftKeyword }),
                        });
                        const result = (await response.json()) as { id?: string };
                        if (result.id) {
                          await utils.learningNotebook.listNotes.invalidate({ topicId });
                          setComposerOpen(false);
                          setDraftKeyword("");
                          router.push(`/learn/${topicId}/notes/${result.id}`);
                        }
                      }}
                      className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950"
                    >
                      Generate draft
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
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
              No notes yet.
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => router.push(`/learn/${topicId}/notes/${note.id}`)}
                  className="w-full rounded-[24px] border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="font-medium text-stone-900 dark:text-stone-100">
                        {note.title || "New page"}
                      </h2>
                      <p className="mt-1 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                        {note.aiSummary || note.plainText || "Empty note"}
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
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { type: "outline" as const, label: "Generate outline", icon: BookOpen },
              { type: "gap" as const, label: "Find blind spots", icon: Brain },
              { type: "quiz" as const, label: "Generate quiz", icon: Sparkles },
            ].map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => generateReview.mutate({ topicId, type: item.type })}
                className="rounded-[24px] border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
              >
                <item.icon className="mb-4 h-5 w-5 text-blue-600" />
                <div className="font-medium text-stone-900 dark:text-stone-100">
                  {item.label}
                </div>
                <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  Use current notes as context.
                </div>
                {generateReview.isPending && (
                  <Loader2 className="mt-3 h-4 w-4 animate-spin text-stone-400" />
                )}
              </button>
            ))}
          </div>

          <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
            <div className="mb-3 flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-blue-600" />
              <h2 className="font-medium text-stone-900 dark:text-stone-100">
                Ask AI
              </h2>
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What parts of Go concurrency am I still missing?"
                className="flex-1 rounded-xl border border-stone-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-stone-700"
              />
              <button
                type="button"
                disabled={ask.isPending || !question.trim()}
                onClick={() => ask.mutate({ topicId, question })}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950"
              >
                Ask
              </button>
            </div>
            {answer && (
              <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                {answer}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {reviews.map((review) => {
              const content = parseReviewContent(review.content);
              return (
                <div
                  key={review.id}
                  className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950"
                >
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-stone-400">
                        {review.type}
                      </div>
                      <h3 className="mt-1 font-medium text-stone-900 dark:text-stone-100">
                        {content?.title || "AI review"}
                      </h3>
                    </div>
                    <span className="text-xs text-stone-400">
                      {formatDate(review.createdAt)}
                    </span>
                  </div>
                  <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
                    {content?.summary}
                  </p>
                  <div className="space-y-3">
                    {content?.items.map((item) => (
                      <div key={item.heading}>
                        <div className="text-sm font-medium text-stone-800 dark:text-stone-100">
                          {item.heading}
                        </div>
                        <div className="text-sm text-stone-500 dark:text-stone-400">
                          {item.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
