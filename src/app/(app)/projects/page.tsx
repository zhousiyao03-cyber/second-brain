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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">
            Open source projects
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Save architecture notes, code-reading findings, and reusable patterns.
          </p>
        </div>
        {activeTab === "projects" && (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={16} />
            Add project
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-900">
        <button
          type="button"
          onClick={() => setActiveTab("projects")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "projects"
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
              : "text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          My Projects
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("discover")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "discover"
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
              : "text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          Discover
        </button>
      </div>

      {activeTab === "projects" ? (
        <>
          {showForm && (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span>Project name</span>
                  <input
                    aria-label="Project name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Repository URL</span>
                  <input
                    aria-label="Repository URL"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Language</span>
                  <input
                    aria-label="Language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Description</span>
                  <input
                    aria-label="Description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-transparent px-3 py-2 outline-none focus:border-blue-400 dark:border-stone-700"
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300"
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
                  className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950"
                >
                  {createProject.isPending && (
                    <Loader2 size={14} className="animate-spin" />
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
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <input
                type="text"
                aria-label="Search projects"
                placeholder="Search projects by name, description, or repo URL…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 dark:border-stone-700"
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
                className="rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                Clear
              </button>
            )}
          </form>

          {isLoading ? (
            <div className="py-12 text-sm text-stone-500">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-stone-300 bg-white/70 px-6 py-16 text-center text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
              <FolderGit2 className="mx-auto mb-4 h-10 w-10 opacity-50" />
              <p className="text-base font-medium">
                {query ? `No projects match “${query}”` : "No tracked projects yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700"
                  >
                    <button
                      type="button"
                      onClick={() => void openProject(project.id)}
                      className="block w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                            {project.name}
                          </h2>
                          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                            {project.language || "Unknown language"}
                          </p>
                        </div>
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                          {project.noteCount} {project.noteCount === 1 ? "note" : "notes"}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                        {project.description || "No description yet."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {project.topTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/projects/${project.id}?view=overview`);
                      }}
                      className="absolute bottom-3 right-4 text-xs text-stone-400 opacity-0 transition-opacity hover:text-stone-700 group-hover:opacity-100 dark:hover:text-stone-200"
                    >
                      Overview →
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="text-stone-500 dark:text-stone-400">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      <ChevronLeft size={14} />
                      Prev
                    </button>
                    <span className="px-2 text-stone-500 dark:text-stone-400">
                      Page {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      Next
                      <ChevronRight size={14} />
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
