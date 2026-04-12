"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export interface AppendTarget {
  id: string;
  title: string;
}

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (target: AppendTarget) => void;
  onClose: () => void;
}

/**
 * Dropdown used by the inline Ask AI popover's "追加到..." action. Fetches
 * notes via `dashboard.search` (notes-only slice) and lets the user either
 * type-to-filter in its own embedded input or navigate with ↑/↓ + Enter.
 *
 * Unlike <InlineAskAiMentionMenu> this menu owns its own text input, because
 * it opens from a button click rather than riding on the popover's main
 * textarea caret.
 */
export function InlineAskAiAppendTargetMenu({
  query,
  onQueryChange,
  onSelect,
  onClose,
}: Props) {
  const [rawActiveIndex, setRawActiveIndex] = useState(0);
  const trimmedQuery = query.trim();

  const { data, isLoading } = trpc.dashboard.search.useQuery(
    { query: trimmedQuery || "a" },
    { refetchOnWindowFocus: false, staleTime: 15_000 }
  );

  const items: AppendTarget[] = useMemo(() => {
    if (!data) return [];
    return (data.notes ?? []).map((n) => ({
      id: n.id,
      title: n.title || "Untitled note",
    }));
  }, [data]);

  const activeIndex = items.length === 0 ? 0 : rawActiveIndex % items.length;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (items.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setRawActiveIndex((prev) => (prev + 1) % items.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setRawActiveIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        onSelect(items[activeIndex]);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [items, activeIndex, onSelect, onClose]);

  return (
    <div
      data-inline-ask-ai-append-menu
      className="absolute left-3 right-3 bottom-full z-20 mb-1 rounded-lg border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900"
    >
      <div className="border-b border-stone-100 px-3 py-2 dark:border-stone-800">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search notes to append to..."
          className="w-full bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
      </div>
      <div className="max-h-52 overflow-y-auto py-1">
        {isLoading && items.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-stone-500 dark:text-stone-400">
            <Loader2 size={13} className="animate-spin" /> Searching...
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-3 text-sm text-stone-500 dark:text-stone-400">
            No matching notes
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label="append target notes"
            className="text-sm text-stone-800 dark:text-stone-100"
          >
            {items.map((item, idx) => {
              const isActive = idx === activeIndex;
              return (
                <li key={item.id} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      // Stop the popover's window-level click-outside handler
                      // from firing: it runs on `window.mousedown` native
                      // phase and checks containerRef.contains(target). When
                      // React unmounts the menu synchronously (setAppendMenuOpen
                      // false inside onSelect), the target button leaves the
                      // DOM before the check runs, so the contains() check
                      // fails and the popover closes. stopImmediatePropagation
                      // on the native event prevents that window handler from
                      // ever seeing the event.
                      e.nativeEvent.stopImmediatePropagation();
                      e.stopPropagation();
                      onSelect(item);
                    }}
                    onMouseEnter={() => setRawActiveIndex(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-stone-100 dark:bg-stone-800"
                        : "hover:bg-stone-50 dark:hover:bg-stone-800/60"
                    }`}
                  >
                    <FileText size={13} className="shrink-0 text-stone-400" />
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
