"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Search, Star, TrendingUp } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** GitHub languages available in the trending filter. */
const LANGUAGES = [
  "",
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c++",
  "swift",
  "kotlin",
];

const LANGUAGE_LABELS: Record<string, string> = {
  "": "All Languages",
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  "c++": "C++",
  swift: "Swift",
  kotlin: "Kotlin",
};

type Since = "daily" | "weekly" | "monthly";

const SINCE_LABELS: Record<Since, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
};

/** Shape returned by the trending query for a single repo entry. */
interface TrendingRepo {
  fullName: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  periodStars: number;
}

/** Normalize a GitHub URL for comparison: lowercase, strip protocol/trailing slash/.git */
function normalizeRepoUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/**
 * Classify user input and return the corresponding full GitHub URL if resolvable.
 * - full URL (contains "github.com/") → returned as-is
 * - "owner/repo" shorthand → expanded to https://github.com/owner/repo
 * - single name (no slash) → null, caller should search
 */
function resolveInputToUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("github.com/")) return trimmed;
  // owner/repo shorthand — exactly two non-empty segments
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 2 && !trimmed.includes(" ")) {
    return `https://github.com/${parts[0]}/${parts[1]}`;
  }
  return null;
}

/** True when the input is a bare search term (single word, no slash). */
function isBareSearchQuery(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.includes("github.com/")) return false;
  if (trimmed.includes("/")) return false;
  return trimmed.length >= 2;
}

export function DiscoverTab() {
  // Time range and language filter state
  const [since, setSince] = useState<Since>("daily");
  const [language, setLanguage] = useState<string>("");

  // URL input for direct repo analysis
  const [urlInput, setUrlInput] = useState<string>("");

  // Track which repo card is currently being analysed (by fullName or url)
  const [analysingKey, setAnalysingKey] = useState<string | null>(null);

  // Provider selection
  const [provider, setProvider] = useState<string>("codex");

  // ── Queries ──────────────────────────────────────────────────────────────

  const trendingQuery = trpc.ossProjects.trending.useQuery(
    { since, language: language || undefined },
    { staleTime: 5 * 60 * 1000 }
  );

  // Existing analysed projects → map normalized repoUrl → projectId
  const projectsQuery = trpc.ossProjects.listProjects.useQuery(undefined, {
    staleTime: 60 * 1000,
  });

  type AnalysedInfo = {
    id: string;
    commit: string | null;
    commitDate: Date | string | null;
    finishedAt: Date | string | null;
  };
  const analysedMap = useMemo(() => {
    const map = new Map<string, AnalysedInfo>();
    for (const p of projectsQuery.data ?? []) {
      const key = normalizeRepoUrl(p.repoUrl);
      if (!key) continue;
      const proj = p as unknown as {
        id: string;
        analysisCommit?: string | null;
        analysisCommitDate?: Date | string | null;
        analysisFinishedAt?: Date | string | null;
      };
      map.set(key, {
        id: proj.id,
        commit: proj.analysisCommit ?? null,
        commitDate: proj.analysisCommitDate ?? null,
        finishedAt: proj.analysisFinishedAt ?? null,
      });
    }
    return map;
  }, [projectsQuery.data]);

  function buildAnalysedTooltip(info: AnalysedInfo): string {
    const parts: string[] = [];
    if (info.commit) parts.push(`commit ${info.commit.slice(0, 7)}`);
    if (info.finishedAt) {
      const d = new Date(info.finishedAt);
      if (!Number.isNaN(d.getTime())) parts.push(`analysed ${d.toLocaleDateString()}`);
    }
    return parts.length ? parts.join(" · ") : "Already analysed";
  }

  const resolvedUrl = resolveInputToUrl(urlInput);
  const isSearchMode = isBareSearchQuery(urlInput);

  const urlPreviewQuery = trpc.ossProjects.fetchRepoInfo.useQuery(
    { url: resolvedUrl ?? "" },
    {
      enabled: Boolean(resolvedUrl),
      staleTime: 60 * 1000,
    }
  );

  const searchQuery = trpc.ossProjects.searchGithub.useQuery(
    { query: urlInput.trim() },
    {
      enabled: isSearchMode,
      staleTime: 60 * 1000,
    }
  );

  // ── Mutation ─────────────────────────────────────────────────────────────

  const startAnalysis = trpc.ossProjects.startAnalysis.useMutation({
    onSuccess: (data) => {
      // Open the project in a new tab so the user keeps their place in Discover
      window.open(`/projects/${data.projectId}`, "_blank", "noopener,noreferrer");
      void projectsQuery.refetch();
    },
    onSettled: () => {
      setAnalysingKey(null);
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  /** Trigger analysis for the URL typed in the input bar. */
  function handleAnalyseUrl() {
    const repoUrl = resolveInputToUrl(urlInput);
    if (!repoUrl) return;

    const preview = urlPreviewQuery.data;
    setAnalysingKey(repoUrl);
    startAnalysis.mutate({
      repoUrl,
      name: preview?.fullName ?? preview?.name ?? undefined,
      description: preview?.description ?? undefined,
      language: preview?.language ?? undefined,
      starsCount: preview?.stars ?? undefined,
      provider,
    });
  }

  /** Trigger analysis for a trending repo card. */
  function handleAnalyseTrending(repo: TrendingRepo) {
    setAnalysingKey(repo.fullName);
    startAnalysis.mutate({
      repoUrl: repo.url,
      name: repo.fullName,
      description: repo.description ?? undefined,
      language: repo.language ?? undefined,
      starsCount: repo.stars,
      provider,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isUrlValid = Boolean(resolvedUrl);
  const urlPreview = urlPreviewQuery.data;
  const urlAnalysedInfo = resolvedUrl ? analysedMap.get(normalizeRepoUrl(resolvedUrl)) : undefined;

  return (
    <div className="space-y-5">
      {/* ── URL input section ─────────────────────────────────────────── */}
      <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/60">
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          <Search size={13} />
          Analyse any GitHub repository
        </h2>

        <div className="flex gap-1.5">
          <input
            type="text"
            aria-label="GitHub repository URL, owner/repo, or search term"
            placeholder="URL, owner/repo, or repo name (e.g. react)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isUrlValid) handleAnalyseUrl();
            }}
            className="flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 dark:placeholder:text-stone-600"
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300"
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          {urlAnalysedInfo ? (
            <a
              href={`/projects/${urlAnalysedInfo.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={buildAnalysedTooltip(urlAnalysedInfo)}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              <CheckCircle2 size={12} className="text-emerald-500" />
              Open
            </a>
          ) : (
            <button
              type="button"
              disabled={!isUrlValid || analysingKey === resolvedUrl}
              onClick={handleAnalyseUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              {analysingKey === resolvedUrl ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              Add &amp; Analyse
            </button>
          )}
        </div>

        {/* URL preview card */}
        {isUrlValid && urlPreview && (
          <div className="mt-2.5 rounded-md border border-stone-100 bg-stone-50/70 px-3 py-2 dark:border-stone-900 dark:bg-stone-900/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                  {urlPreview.fullName ?? urlPreview.name}
                </p>
                {urlPreview.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">
                    {urlPreview.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                <Star size={11} className="text-amber-500" />
                {urlPreview.stars?.toLocaleString() ?? "—"}
              </div>
            </div>
            {urlPreview.language && (
              <span className="mt-1.5 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                {urlPreview.language}
              </span>
            )}
          </div>
        )}

        {/* Loading indicator for URL preview */}
        {isUrlValid && urlPreviewQuery.isLoading && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
            <Loader2 size={11} className="animate-spin" />
            Fetching repository info…
          </p>
        )}

        {/* Search candidates (bare name input) */}
        {isSearchMode && (
          <div className="mt-2.5">
            {searchQuery.isLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
                <Loader2 size={11} className="animate-spin" />
                Searching GitHub for &ldquo;{urlInput.trim()}&rdquo;…
              </p>
            ) : searchQuery.isError ? (
              <p className="text-[11px] text-red-500">Search failed. Try again.</p>
            ) : searchQuery.data && searchQuery.data.length > 0 ? (
              <div className="space-y-1.5" data-testid="github-search-results">
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  Top matches for &ldquo;{urlInput.trim()}&rdquo; — click to select:
                </p>
                {searchQuery.data.map((item) => {
                  const analysed = analysedMap.get(normalizeRepoUrl(item.url));
                  return (
                    <button
                      key={item.fullName}
                      type="button"
                      onClick={() => setUrlInput(item.url)}
                      className="flex w-full items-start justify-between gap-3 rounded-md border border-stone-100 bg-white/50 px-3 py-2 text-left transition-colors hover:border-stone-300 hover:bg-white dark:border-stone-900 dark:bg-stone-900/40 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                            {item.fullName}
                          </span>
                          {item.language && (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                              {item.language}
                            </span>
                          )}
                          {analysed && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                              <CheckCircle2 size={10} />
                              Analysed
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-stone-500 dark:text-stone-400">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <Star size={11} className="text-amber-500" />
                        {item.stars.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                No repositories found.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Trending section ──────────────────────────────────────────── */}
      <div>
        {/* Header with time range toggle and language filter */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            <TrendingUp size={13} />
            Trending on GitHub
          </h2>

          <div className="flex flex-wrap items-center gap-3">
            {/* Time range — underline segmented */}
            <div className="flex items-center gap-3 text-[11px]">
              {(Object.keys(SINCE_LABELS) as Since[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSince(key)}
                  className={`border-b pb-0.5 font-medium transition-colors ${
                    since === key
                      ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
                      : "border-transparent text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300"
                  }`}
                >
                  {SINCE_LABELS[key]}
                </button>
              ))}
            </div>

            {/* Language filter */}
            <select
              aria-label="Filter by language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-600 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Trending repo list */}
        {trendingQuery.isLoading ? (
          <div className="flex items-center gap-2 py-12 text-xs text-stone-400 dark:text-stone-500">
            <Loader2 size={14} className="animate-spin" />
            Loading trending repositories…
          </div>
        ) : trendingQuery.isError ? (
          <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-600 dark:border-red-950/40 dark:bg-red-950/10 dark:text-red-400">
            Failed to load trending repositories. Please try again later.
          </div>
        ) : !trendingQuery.data || trendingQuery.data.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-200 bg-white/50 px-6 py-12 text-center text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-500">
            No trending repositories found for the selected filters.
          </div>
        ) : (
          <div className="divide-y divide-stone-100 overflow-hidden rounded-md border border-stone-200 bg-white/60 dark:divide-stone-900 dark:border-stone-800 dark:bg-stone-950/50">
            {trendingQuery.data.map((repo) => {
              const isAnalysing = analysingKey === repo.fullName;
              const analysedInfo = analysedMap.get(normalizeRepoUrl(repo.url));

              return (
                <div
                  key={repo.fullName}
                  className="px-3.5 py-3 transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-900/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Repo name + description */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {repo.fullName}
                        </span>
                        {repo.language && (
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                            {repo.language}
                          </span>
                        )}
                        {analysedInfo && (
                          <span
                            title={buildAnalysedTooltip(analysedInfo)}
                            className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          >
                            <CheckCircle2 size={10} />
                            Analysed
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">
                          {repo.description}
                        </p>
                      )}
                    </div>

                    {/* Stars */}
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                      <span className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-400">
                        <Star size={11} className="text-amber-500" />
                        {repo.stars.toLocaleString()}
                      </span>
                      {repo.periodStars > 0 && (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          +{repo.periodStars.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-2 flex items-center gap-1.5">
                    <a
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-200"
                    >
                      <ExternalLink size={11} />
                      GitHub
                    </a>
                    {analysedInfo ? (
                      <a
                        href={`/projects/${analysedInfo.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={buildAnalysedTooltip(analysedInfo)}
                        className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                      >
                        <CheckCircle2 size={11} className="text-emerald-500" />
                        Open analysis
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled={isAnalysing}
                        onClick={() => handleAnalyseTrending(repo)}
                        className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                      >
                        {isAnalysing ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : null}
                        Add &amp; Analyse
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
