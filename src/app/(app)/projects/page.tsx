"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function ProjectsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");

  const { data: projects = [], isLoading } = trpc.ossProjects.listProjects.useQuery();
  const createProject = trpc.ossProjects.createProject.useMutation({
    onSuccess: async (data) => {
      await utils.ossProjects.listProjects.invalidate();
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
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={16} />
          Add project
        </button>
      </div>

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

      {isLoading ? (
        <div className="py-12 text-sm text-stone-500">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-stone-300 bg-white/70 px-6 py-16 text-center text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
          <FolderGit2 className="mx-auto mb-4 h-10 w-10 opacity-50" />
          <p className="text-base font-medium">No tracked projects yet</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => router.push(`/projects/${project.id}`)}
              className="rounded-[28px] border border-stone-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700"
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
          ))}
        </div>
      )}
    </div>
  );
}
