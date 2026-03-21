"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Plus, Trash2, ExternalLink, Bookmark, Sparkles, Loader2 } from "lucide-react";

export default function BookmarksPage() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [summarizing, setSummarizing] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: bookmarks = [], isLoading } = trpc.bookmarks.list.useQuery();
  const createBookmark = trpc.bookmarks.create.useMutation({
    onSuccess: () => {
      utils.bookmarks.list.invalidate();
      setUrl("");
      setTitle("");
      setShowForm(false);
    },
  });
  const deleteBookmark = trpc.bookmarks.delete.useMutation({
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

  const formatDate = (date: Date | null) => {
    if (!date) return "";
    return new Date(date).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">收藏</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          添加收藏
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL（可选）"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={(!url.trim() && !title.trim()) || createBookmark.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-100"
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-500 text-sm">加载中...</p>
      ) : bookmarks.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Bookmark size={48} className="mx-auto mb-3 opacity-50" />
          <p>还没有收藏，点击添加开始吧</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bookmarks.map((bm) => (
            <div
              key={bm.id}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg group"
            >
              <Bookmark size={16} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 truncate text-sm">
                    {bm.title ?? bm.url ?? "无标题"}
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
                  {bm.status && bm.status !== "processed" && (
                    <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-600 rounded">
                      {bm.status}
                    </span>
                  )}
                </div>
                {bm.summary && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{bm.summary}</p>
                )}
              </div>
              {!bm.summary && (
                <button
                  onClick={async () => {
                    setSummarizing(bm.id);
                    try {
                      await fetch("/api/summarize", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookmarkId: bm.id }),
                      });
                      utils.bookmarks.list.invalidate();
                    } finally {
                      setSummarizing(null);
                    }
                  }}
                  disabled={summarizing === bm.id}
                  className="p-1 text-gray-400 hover:text-purple-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100"
                  title="AI 生成摘要"
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
                title="删除"
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
