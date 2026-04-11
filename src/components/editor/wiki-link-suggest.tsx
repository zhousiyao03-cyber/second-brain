"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface WikiLinkSuggestProps {
  query: string;
  position: { top: number; left: number };
  onSelect: (noteId: string, noteTitle: string) => void;
  onCreateNew: (title: string) => void;
  onClose: () => void;
}

/**
 * Inner component keyed by query so selectedIndex resets on query change.
 */
function WikiLinkSuggestInner({
  query,
  position,
  onSelect,
  onCreateNew,
  onClose,
  results,
}: WikiLinkSuggestProps & {
  results: Array<{ id: string; title: string; icon: string | null }>;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => [
      ...results,
      ...(query.trim()
        ? [{ id: "__create__", title: `Create "${query}"`, icon: null }]
        : []),
    ],
    [results, query]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1)
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) {
          if (item.id === "__create__") {
            onCreateNew(query.trim());
          } else {
            onSelect(item.id, item.title);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [items, selectedIndex, query, onSelect, onCreateNew, onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler as EventListener);
    return () =>
      document.removeEventListener("mousedown", handler as EventListener);
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 max-h-[240px] w-[280px] overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => {
            if (item.id === "__create__") {
              onCreateNew(query.trim());
            } else {
              onSelect(item.id, item.title);
            }
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
            index === selectedIndex
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              : "text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
          )}
        >
          {item.id === "__create__" ? (
            <Plus size={14} className="shrink-0 text-blue-500" />
          ) : item.icon ? (
            <span className="shrink-0 text-sm">{item.icon}</span>
          ) : (
            <FileText size={14} className="shrink-0 text-stone-400" />
          )}
          <span className="truncate">{item.title}</span>
        </button>
      ))}
    </div>
  );
}

export function WikiLinkSuggest(props: WikiLinkSuggestProps) {
  // Only search when there's a real query — don't fallback to "a"
  const hasQuery = props.query.trim().length > 0;
  const { data: results = [] } = trpc.notes.searchByTitle.useQuery(
    { query: props.query },
    { enabled: hasQuery, staleTime: 5000 }
  );

  // Key by query so selectedIndex resets on query change
  return <WikiLinkSuggestInner key={props.query} {...props} results={results} />;
}
