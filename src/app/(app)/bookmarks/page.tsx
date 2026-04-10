"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  Plus,
  Trash2,
  ExternalLink,
  Bookmark,
  Sparkles,
  Loader2,
  Search,
  RefreshCw,
} from "lucide-react";

export default function BookmarksPage() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "url" | "text">("all");
  const { toast } = useToast();

  const utils = trpc.useUtils();
  const { data: bookmarkResult, isLoading } = trpc.bookmarks.list.useQuery();
  const bookmarks = bookmarkResult?.items ?? [];
  const createBookmark = trpc.bookmarks.create.useMutation({
    onSuccess: () => {
      utils.bookmarks.list.invalidate();
      setUrl("");
      setTitle("");
      setShowForm(false);
    },
  });
  const deleteBookmark = trpc.bookmarks.delete.useMutation({
    onSuccess: () => {
      utils.bookmarks.list.invalidate();
      toast("Bookmark deleted", "success");
    },
  });
  const refetchBookmark = trpc.bookmarks.refetch.useMutation({
    onSuccess: () => utils.bookmarks.list.invalidate(),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() && !title.trim()) return;
    createBookmark.mutate({
      url: url.trim() || undefined,
      title: title.trim() || url.trim(),
      source: url.trim() ? "url" : "text",
    });
  };

  const filteredBookmarks = useMemo(() => {
    return bookmarks.filter((bm) => {
      // Source filter
      if (sourceFilter !== "all" && bm.source !== sourceFilter) return false;
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const searchable = [bm.title, bm.url, bm.summary, bm.content]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [bookmarks, searchQuery, sourceFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Bookmarks</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add bookmark
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900">
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL (optional)"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={(!url.trim() && !title.trim()) || createBookmark.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {createBookmark.isPending ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Search and filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bookmarks..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as "all" | "url" | "text")}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Filter by source"
        >
          <option value="all">All</option>
          <option value="url">URL</option>
          <option value="text">Text</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : filteredBookmarks.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Bookmark size={48} className="mx-auto mb-3 opacity-50" />
          <p>{bookmarks.length === 0 ? "No bookmarks yet. Add your first one." : "No matching bookmarks."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBookmarks.map((bm) => (
            <div
              key={bm.id}
              className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg group"
            >
              <Bookmark size={16} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                    {bm.title ?? bm.url ?? "Untitled"}
                  </h3>
                  {bm.url && (
                    <a
                      href={bm.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">
                    {formatDate(bm.createdAt)}
                  </span>
                  {bm.source && (
                    <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                      {bm.source}
                    </span>
                  )}
                  {bm.status === "pending" && (
                    <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                      Fetching
                    </span>
                  )}
                  {bm.status === "failed" && (
                    <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded">
                      Fetch failed
                    </span>
                  )}
                </div>
                {bm.content && !bm.summary && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {bm.content.slice(0, 100)}...
                  </p>
                )}
                {bm.summary && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{bm.summary}</p>
                )}
                {bm.tags && (
                  <div className="flex gap-1 mt-1">
                    {(JSON.parse(bm.tags) as string[]).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Refetch button for failed bookmarks */}
              {bm.status === "failed" && bm.url && (
                <button
                  onClick={() => refetchBookmark.mutate({ id: bm.id })}
                  disabled={refetchBookmark.isPending}
                  className="p-1 text-orange-400 hover:text-orange-600 transition-all"
                  title="Retry fetch"
                >
                  {refetchBookmark.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                </button>
              )}
              {/* Summarize button */}
              {!bm.summary && bm.status === "processed" && (
                <button
                  onClick={async () => {
                    setSummarizing(bm.id);
                    try {
                      const res = await fetch("/api/summarize", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookmarkId: bm.id }),
                      });
                      utils.bookmarks.list.invalidate();
                      if (res.ok) {
                        toast("Summary generated", "success");
                      } else {
                        toast("Summary generation failed", "error");
                      }
                    } catch {
                      toast("Summary generation failed", "error");
                    } finally {
                      setSummarizing(null);
                    }
                  }}
                  disabled={summarizing === bm.id}
                  className="p-1 text-gray-400 hover:text-purple-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100"
                  title="Generate AI summary"
                >
                  {summarizing === bm.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                </button>
              )}
              <button
                onClick={() => deleteBookmark.mutate({ id: bm.id })}
                className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
