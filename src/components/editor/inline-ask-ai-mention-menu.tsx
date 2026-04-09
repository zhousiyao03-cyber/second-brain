"use client";

import { useEffect, useMemo, useState } from "react";
import { Bookmark, FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export interface MentionSource {
  id: string;
  type: "note" | "bookmark";
  title: string;
}

interface Props {
  query: string;
  onSelect: (source: MentionSource) => void;
  onClose: () => void;
}

/**
 * Inline @mention menu used inside <InlineAskAiPopover>. Searches notes and
 * bookmarks via the existing `dashboard.search` tRPC query and renders the
 * results as a small grouped dropdown. Keyboard navigation: ↑/↓ to move,
 * Enter to pick, Esc to close.
 *
 * This component does **not** manage its own positioning — callers render it
 * absolutely inside the popover body so it always sticks below the textarea.
 */
export function InlineAskAiMentionMenu({ query, onSelect, onClose }: Props) {
  // `rawActiveIndex` is the user's latest intent; we clamp it against the
  // current items.length during render so a stale index never points at an
  // item that no longer exists (avoids a setState-in-effect reset).
  const [rawActiveIndex, setRawActiveIndex] = useState(0);
  const trimmedQuery = query.trim();

  const { data, isLoading } = trpc.dashboard.search.useQuery(
    { query: trimmedQuery || "a" }, // tRPC rejects empty; seed with "a" to show *something* on first @
    {
      enabled: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );

  const items: MentionSource[] = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.notes ?? []).map((n) => ({
        id: n.id,
        type: "note" as const,
        title: n.title || "未命名笔记",
      })),
      ...(data.bookmarks ?? []).map((b) => ({
        id: b.id,
        type: "bookmark" as const,
        title: b.title || b.url || "未命名收藏",
      })),
    ];
  }, [data]);

  const activeIndex = items.length === 0 ? 0 : rawActiveIndex % items.length;

  // Global key handler — we capture keys *before* the textarea sees them
  // so Enter can pick instead of newline.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (items.length === 0 && event.key !== "Escape") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setRawActiveIndex((prev) =>
          items.length ? (prev + 1) % items.length : 0
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setRawActiveIndex((prev) =>
          items.length ? (prev - 1 + items.length) % items.length : 0
        );
      } else if (event.key === "Enter") {
        if (items.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(items[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [items, activeIndex, onSelect, onClose]);

  return (
    <div
      data-inline-ask-ai-mention-menu
      className="absolute left-3 right-3 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-xl dark:border-stone-700 dark:bg-stone-900"
    >
      {isLoading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-stone-500 dark:text-stone-400">
          <Loader2 size={13} className="animate-spin" /> 搜索中…
        </div>
      ) : items.length === 0 ? (
        <div className="px-3 py-3 text-stone-500 dark:text-stone-400">
          没有匹配的 source
        </div>
      ) : (
        <ul role="listbox" aria-label="mention results" className="text-stone-800 dark:text-stone-100">
          {items.map((item, idx) => {
            const Icon = item.type === "note" ? FileText : Bookmark;
            const isActive = idx === activeIndex;
            return (
              <li key={`${item.type}-${item.id}`} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // onMouseDown instead of onClick to fire before the
                    // textarea blurs and clears selection state.
                    e.preventDefault();
                    onSelect(item);
                  }}
                  onMouseEnter={() => setRawActiveIndex(idx)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-stone-100 dark:bg-stone-800"
                      : "hover:bg-stone-50 dark:hover:bg-stone-800/60"
                  }`}
                >
                  <Icon size={13} className="shrink-0 text-stone-400" />
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-stone-400 dark:text-stone-500">
                    {item.type === "note" ? "笔记" : "收藏"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
