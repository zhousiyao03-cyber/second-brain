"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderGit2, Loader2, Plus, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { DiscoverTab } from "./discover-tab";

type Tab = "projects" | "discover";
const PAGE_SIZE = 20;

export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<Tab>("projects");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");

  // Pagination + search state, hydrated from URL so refresh/share keep context
  const initialPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const initialQuery = searchParams.get("q") ?? "";
  const [page, setPage] = useState(initialPage);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  // Push state → URL query on change
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (query) params.set("q", query);
    const qs = params.toString();
    router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
  }, [page, query, router]);

  const pagedQuery = trpc.ossProjects.listProjectsPaged.useQuery({
    page,
    pageSize: PAGE_SIZE,
    q: query || undefined,
  });
  const projects = pagedQuery.data?.items ?? [];
  const totalPages = pagedQuery.data?.totalPages ?? 1;
  const total = pagedQuery.data?.total ?? 0;
  const isLoading = pagedQuery.isLoading;

  const firstNoteUtils = trpc.useUtils();
  async function openProject(projectId: string) {
    // Try to jump straight to most recently updated note; fall back to overview.
    const noteId = await firstNoteUtils.ossProjects.firstNoteId.fetch({ projectId });
    if (noteId) {
      router.push(`/projects/${projectId}/notes/${noteId}`);
    } else {
      router.push(`/projects/${projectId}?view=overview`);
    }
  }
  const createProject = trpc.ossProjects.createProject.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.ossProjects.listProjects.invalidate(),
        utils.ossProjects.listProjectsPaged.invalidate(),
      ]);
      setShowForm(false);
      setName("");
      setRepoUrl("");
      setLanguage("");
      setDescription("");
      router.push(`/projects/${data.id}`);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Open source projects
          </h1>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            Save architecture notes, code-reading findings, and reusable patterns.
          </p>
        </div>
        {activeTab === "projects" && (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            <Plus size={13} />
            Add project
          </button>
        )}
      </div>

      {/* Tab bar — underline style */}
      <div className="flex items-center gap-5 border-b border-stone-200 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setActiveTab("projects")}
          className={`-mb-px border-b-2 pb-2 text-xs font-medium transition-colors ${
            activeTab === "projects"
              ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
              : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          My projects
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("discover")}
          className={`-mb-px border-b-2 pb-2 text-xs font-medium transition-colors ${
            activeTab === "discover"
              ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
              : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          Discover
        </button>
      </div>

      {activeTab === "projects" ? (
        <>
          {showForm && (
            <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/60">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>Project name</span>
                  <input
                    aria-label="Project name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
                  />
                </label>
                <label className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>Repository URL</span>
                  <input
                    aria-label="Repository URL"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
                  />
                </label>
                <label className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>Language</span>
                  <input
                    aria-label="Language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
                  />
                </label>
                <label className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>Description</span>
                  <input
                    aria-label="Description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!name.trim() || createProject.isPending}
                  onClick={() =>
                    createProject.mutate({
                      name,
                      repoUrl,
                      language,
                      description,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  {createProject.isPending && (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  Create project
                </button>
              </div>
            </div>
          )}

          {/* Search bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(searchInput.trim());
            }}
            className="flex items-center gap-1.5"
          >
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <input
                type="text"
                aria-label="Search projects"
                placeholder="Search projects by name, description, or repo URL…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-md border border-stone-200 bg-white/70 py-1.5 pl-8 pr-3 text-xs text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none dark:border-stone-800 dark:bg-stone-950/50 dark:text-stone-200 dark:focus:border-stone-600"
              />
            </div>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  setPage(1);
                }}
                className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-900"
              >
                Clear
              </button>
            )}
          </form>

          {isLoading ? (
            <div className="py-12 text-xs text-stone-400">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="rounded-md border border-dashed border-stone-200 bg-white/50 px-6 py-16 text-center dark:border-stone-800 dark:bg-stone-950/40">
              <FolderGit2 className="mx-auto mb-3 h-8 w-8 text-stone-300 dark:text-stone-700" />
              <p className="text-sm text-stone-400 dark:text-stone-500">
                {query ? `No projects match “${query}”` : "No tracked projects yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative flex min-h-[120px] flex-col rounded-md border border-stone-200 bg-white/70 p-3.5 transition-colors hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-950/50 dark:hover:border-stone-700 dark:hover:bg-stone-950"
                  >
                    <button
                      type="button"
                      onClick={() => void openProject(project.id)}
                      className="flex flex-1 flex-col text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                            {project.name}
                          </h2>
                          <p className="mt-0.5 truncate text-[11px] text-stone-400 dark:text-stone-500">
                            {project.language || "Unknown language"}
                          </p>
                        </div>
                        <span className="shrink-0 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                          {project.noteCount} {project.noteCount === 1 ? "note" : "notes"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 flex-1 text-xs text-stone-500 dark:text-stone-400">
                        {project.description || "No description yet."}
                      </p>
                      {project.topTags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {project.topTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-900 dark:text-stone-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/projects/${project.id}?view=overview`);
                      }}
                      className="absolute bottom-2 right-3 text-[10px] text-stone-400 opacity-0 transition-opacity hover:text-stone-700 group-hover:opacity-100 dark:hover:text-stone-200"
                    >
                      Overview →
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="mt-5 flex items-center justify-between text-xs">
                  <span className="text-stone-400 dark:text-stone-500">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-900"
                    >
                      <ChevronLeft size={12} />
                      Prev
                    </button>
                    <span className="px-1 text-stone-400 dark:text-stone-500">
                      Page {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-900"
                    >
                      Next
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <DiscoverTab />
      )}
    </div>
  );
}
