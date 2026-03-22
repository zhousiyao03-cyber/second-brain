"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Search, FileText, Bookmark, CheckSquare, X } from "lucide-react";

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 text-gray-900 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const { data } = trpc.dashboard.search.useQuery(
    { query },
    { enabled: open && query.length > 0 }
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    },
    []
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const navigate = (href: string) => {
    close();
    router.push(href);
  };

  const allResults = [
    ...(data?.notes.map((n) => ({
      id: n.id,
      title: n.title,
      type: "note" as const,
      href: `/notes/${n.id}`,
      icon: FileText,
    })) ?? []),
    ...(data?.bookmarks.map((b) => ({
      id: b.id,
      title: b.title ?? b.url ?? "无标题",
      type: "bookmark" as const,
      href: "/bookmarks",
      icon: Bookmark,
    })) ?? []),
    ...(data?.todos.map((t) => ({
      id: t.id,
      title: t.title,
      type: "todo" as const,
      href: "/todos",
      icon: CheckSquare,
    })) ?? []),
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={close}
      />

      {/* Dialog */}
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <Search size={18} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记、收藏、待办..."
              className="flex-1 text-sm outline-none placeholder:text-gray-400 bg-transparent dark:text-gray-100"
              autoFocus
            />
            <button
              onClick={close}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-auto">
            {query.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                输入关键词搜索
              </div>
            ) : allResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                没有找到结果
              </div>
            ) : (
              <div className="py-2">
                {allResults.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => navigate(item.href)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                  >
                    <item.icon size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
                      <HighlightText text={item.title} query={query} />
                    </span>
                    <span className="text-xs text-gray-400">
                      {item.type === "note"
                        ? "笔记"
                        : item.type === "bookmark"
                          ? "收藏"
                          : "待办"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                ⌘K
              </kbd>{" "}
              打开搜索
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                ESC
              </kbd>{" "}
              关闭
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
