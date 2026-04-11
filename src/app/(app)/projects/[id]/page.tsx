"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  GitCommit,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";

// Map noteType to display label and icon
const NOTE_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  analysis: { label: "Source Analysis", icon: "📊" },
  followup: { label: "Follow-up", icon: "💬" },
  manual: { label: "Notes", icon: "✍️" },
};

// Render groups in this fixed order
const NOTE_TYPE_ORDER = ["analysis", "followup", "manual"];

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceOverview = searchParams.get("view") === "overview";
  const utils = trpc.useUtils();
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [followupQuestion, setFollowupQuestion] = useState("");

  // ---------- Queries ----------

  const { data: project, isLoading: projectLoading } =
    trpc.ossProjects.getProject.useQuery({ id });

  const { data: notes = [], isLoading: notesLoading } =
    trpc.ossProjects.listNotes.useQuery({ projectId: id, tag: selectedTag });

  // Auto-jump to the most recently updated note unless user explicitly requested
  // the project overview via ?view=overview.
  useEffect(() => {
    if (forceOverview) return;
    if (notesLoading) return;
    if (selectedTag) return; // tag filter means user is actively browsing
    if (notes.length === 0) return;
    const firstNoteId = notes[0]?.id;
    if (firstNoteId) {
      router.replace(`/projects/${id}/notes/${firstNoteId}`);
    }
  }, [forceOverview, notes, notesLoading, selectedTag, id, router]);

  // Poll every 5 s while status is "analyzing" or "pending"
  const { data: analysisInfo } = trpc.ossProjects.analysisStatus.useQuery(
    { projectId: id },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.analysisStatus;
        return status === "queued" || status === "running" ? 5000 : false;
      },
    }
  );

  const analysisStatus = analysisInfo?.analysisStatus ?? null;
  const analysisError = analysisInfo?.analysisError ?? null;
  const activeTaskId = analysisInfo?.activeTaskId ?? null;
  const activeProvider = analysisInfo?.activeProvider ?? "claude";
  const [messages, setMessages] = useState<Array<{ seq: number; type: string; tool?: string; summary?: string }>>([]);
  const lastSeqRef = useRef(0);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);

  // Poll messages every 2s while running
  useEffect(() => {
    if (!activeTaskId || (analysisStatus !== "queued" && analysisStatus !== "running")) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/analysis/messages?taskId=${activeTaskId}&afterSeq=${lastSeqRef.current}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length) {
          setMessages((prev) => [...prev, ...data.messages]);
          lastSeqRef.current = data.messages[data.messages.length - 1].seq;
        }
      } catch {
        // skip
      }
    };

    poll(); // initial fetch
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [activeTaskId, analysisStatus]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // When analysis transitions to completed, refresh notes and project data
  useEffect(() => {
    if (analysisStatus === "completed") {
      void utils.ossProjects.listNotes.invalidate({ projectId: id });
      void utils.ossProjects.getProject.invalidate({ id });
    }
  }, [analysisStatus, id, utils]);

  // ---------- Mutations ----------

  const startAnalysis = trpc.ossProjects.startAnalysis.useMutation({
    onSuccess: () => {
      setMessages([]);
      lastSeqRef.current = 0;
      void utils.ossProjects.analysisStatus.invalidate({ projectId: id });
      void utils.ossProjects.getProject.invalidate({ id });
    },
  });

  const askFollowup = trpc.ossProjects.askFollowup.useMutation({
    onSuccess: async () => {
      setFollowupQuestion("");
      setMessages([]);
      lastSeqRef.current = 0;
      await utils.ossProjects.listNotes.invalidate({ projectId: id });
    },
  });

  const deleteProject = trpc.ossProjects.deleteProject.useMutation({
    onSuccess: () => {
      router.push("/projects");
    },
  });

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: async () => {
      await utils.ossProjects.listNotes.invalidate({ projectId: id });
    },
  });

  // ---------- Derived data ----------

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

  // Group notes by noteType; fall back to "manual" for notes without a type
  const groupedNotes = useMemo(() => {
    const groups: Record<string, typeof notes> = {};
    for (const note of notes) {
      const type = (note as { noteType?: string }).noteType ?? "manual";
      if (!groups[type]) groups[type] = [];
      groups[type].push(note);
    }
    return groups;
  }, [notes]);

  // Whether this project can be analysed but hasn't been yet
  const canStartAnalysis =
    project?.repoUrl && !analysisStatus && !startAnalysis.isPending;

  // Whether a re-analysis can be triggered (already analysed once, not currently running)
  const canReanalyse =
    project?.repoUrl &&
    analysisStatus === "completed" &&
    !startAnalysis.isPending;

  // Surface analysis snapshot info from the project record. These fields are
  // populated by the daemon → /api/analysis/complete after a successful run.
  const analysisCommit = (project as { analysisCommit?: string | null } | null)?.analysisCommit ?? null;
  const analysisCommitDate = (project as { analysisCommitDate?: Date | null } | null)?.analysisCommitDate ?? null;
  const analysisFinishedAt = (project as { analysisFinishedAt?: Date | null } | null)?.analysisFinishedAt ?? null;

  // ---------- Handlers ----------

  function handleFollowupSubmit() {
    const q = followupQuestion.trim();
    if (!q || askFollowup.isPending) return;
    askFollowup.mutate({ projectId: id, question: q });
  }

  // ---------- Render ----------

  if (projectLoading) {
    return <div className="py-12 text-sm text-stone-500">Loading project...</div>;
  }

  if (!project) {
    return (
      <div className="py-12 text-center text-stone-500">Project not found.</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All Projects
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
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
            {/* Stars count */}
            {(project as { starsCount?: number | null }).starsCount != null && (
              <span className="flex items-center gap-1">
                ⭐{" "}
                {(
                  project as { starsCount?: number | null }
                ).starsCount?.toLocaleString()}
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

          {/* Analysis snapshot row — exact commit + when it was analysed.
              Open source projects keep evolving, so this tells the reader
              how stale the existing analysis might be. */}
          {analysisCommit && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <GitCommit size={12} />
              <span>Analysed at commit</span>
              {project.repoUrl ? (
                <a
                  href={`${project.repoUrl}/commit/${analysisCommit}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {analysisCommit.slice(0, 7)}
                </a>
              ) : (
                <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700 dark:bg-stone-900 dark:text-stone-300">
                  {analysisCommit.slice(0, 7)}
                </span>
              )}
              {analysisCommitDate && (
                <span>· committed {formatDate(analysisCommitDate)}</span>
              )}
              {analysisFinishedAt && (
                <span>· run {formatDate(analysisFinishedAt)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Analyze button — shown when there is a repo URL but no analysis yet */}
          {canStartAnalysis && (
            <button
              type="button"
              onClick={() =>
                startAnalysis.mutate({
                  projectId: id,
                  repoUrl: project.repoUrl!,
                  name: project.name,
                  description: project.description ?? undefined,
                  language: project.language ?? undefined,
                  starsCount:
                    (project as { starsCount?: number | null }).starsCount ??
                    undefined,
                })
              }
              className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              Analyze
            </button>
          )}

          {/* Re-analyse button — open source projects move fast, so we let
              users pick up the latest commit and produce a fresh note. */}
          {canReanalyse && (
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "Re-analyse this project against the latest commit? A new analysis note will be added — the existing one is preserved."
                  )
                ) {
                  startAnalysis.mutate({
                    projectId: id,
                    repoUrl: project.repoUrl!,
                    name: project.name,
                    description: project.description ?? undefined,
                    language: project.language ?? undefined,
                    starsCount:
                      (project as { starsCount?: number | null }).starsCount ??
                      undefined,
                  });
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              <RefreshCw size={14} />
              Re-analyse
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this project and all its notes?")) {
                deleteProject.mutate({ id });
              }
            }}
            disabled={deleteProject.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Analysis status banner ─────────────────────────────────────────── */}
      {(analysisStatus === "queued" || analysisStatus === "running") && (
        <div className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-blue-700 dark:text-blue-300">
            <Loader2 size={16} className="animate-spin shrink-0" />
            <span className="grow">
              {analysisStatus === "queued"
                ? "Analysis queued — waiting for local daemon…"
                : `Analysing repository with ${activeProvider === "codex" ? "Codex" : "Claude"}…`}
            </span>
          </div>

          {/* Message timeline */}
          {messages.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto border-t border-blue-200 bg-white/50 px-5 py-3 font-mono text-xs leading-relaxed text-stone-600 dark:border-blue-800 dark:bg-stone-950/50 dark:text-stone-400">
              {messages.map((msg) => (
                <div key={msg.seq} className="py-0.5">
                  {msg.type === "tool_use" && (
                    <span>
                      <span className="text-blue-600 dark:text-blue-400">
                        {msg.tool}
                      </span>{" "}
                      {msg.summary}
                    </span>
                  )}
                  {msg.type === "text" && (
                    <span className="text-stone-500 italic">{msg.summary}</span>
                  )}
                  {msg.type === "error" && (
                    <span className="text-red-600 dark:text-red-400">
                      {msg.summary}
                    </span>
                  )}
                </div>
              ))}
              <div ref={timelineEndRef} />
            </div>
          )}
        </div>
      )}

      {analysisStatus === "failed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <span className="grow">
            Analysis failed
            {analysisError ? `: ${analysisError}` : "."}
          </span>
          <button
            type="button"
            onClick={() =>
              startAnalysis.mutate({
                projectId: id,
                repoUrl: project.repoUrl!,
                name: project.name,
                description: project.description ?? undefined,
                language: project.language ?? undefined,
                starsCount:
                  (project as { starsCount?: number | null }).starsCount ??
                  undefined,
              })
            }
            disabled={startAnalysis.isPending}
            className="shrink-0 rounded-lg bg-red-100 px-3 py-1 font-medium transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:hover:bg-red-800"
          >
            {startAnalysis.isPending ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {/* ── Follow-up input — only when analysis has completed ─────────────── */}
      {analysisStatus === "completed" && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={followupQuestion}
            onChange={(e) => setFollowupQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFollowupSubmit();
            }}
            placeholder="Ask a follow-up question about this project…"
            disabled={askFollowup.isPending}
            className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-blue-600 dark:focus:ring-blue-900"
          />
          <button
            type="button"
            onClick={handleFollowupSubmit}
            disabled={!followupQuestion.trim() || askFollowup.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {askFollowup.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Claude is reading…
              </>
            ) : (
              <>
                <Send size={14} />
                Send
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Tag filter ───────────────────────────────────────────────────────── */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setSelectedTag((current) => (current === tag ? undefined : tag))
              }
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

      {/* ── Notes list ───────────────────────────────────────────────────────── */}
      {notesLoading ? (
        <div className="py-12 text-sm text-stone-500">Loading notes...</div>
      ) : notes.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/70 px-6 py-14 text-center text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
          No project notes yet.
        </div>
      ) : (
        <div className="space-y-6">
          {NOTE_TYPE_ORDER.map((type) => {
            const group = groupedNotes[type];
            if (!group || group.length === 0) return null;
            const meta = NOTE_TYPE_LABELS[type] ?? { label: type, icon: "📄" };
            return (
              <div key={type} className="space-y-3">
                {/* Group header */}
                <div className="flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400">
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                  <span className="text-xs text-stone-400 dark:text-stone-600">
                    ({group.length})
                  </span>
                </div>

                {/* Notes in this group */}
                {group.map((note) => (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      router.push(`/notes/${note.id}`)
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(`/notes/${note.id}`);
                    }}
                    className="group w-full rounded-[20px] border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900 dark:focus:ring-blue-900"
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
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-stone-400">
                          {formatDate(note.updatedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this note?")) {
                              deleteNote.mutate({ id: note.id });
                            }
                          }}
                          className="rounded-lg p-1 text-stone-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-950"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Render any noteTypes that aren't in NOTE_TYPE_ORDER (future-proof) */}
          {Object.entries(groupedNotes)
            .filter(([type]) => !NOTE_TYPE_ORDER.includes(type))
            .map(([type, group]) => {
              const meta = NOTE_TYPE_LABELS[type] ?? {
                label: type,
                icon: "📄",
              };
              return (
                <div key={type} className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400">
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                    <span className="text-xs text-stone-400 dark:text-stone-600">
                      ({group.length})
                    </span>
                  </div>
                  {group.map((note) => (
                    <div
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        router.push(`/notes/${note.id}`)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        router.push(`/notes/${note.id}`);
                      }}
                      className="group w-full rounded-[20px] border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900 dark:focus:ring-blue-900"
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
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
