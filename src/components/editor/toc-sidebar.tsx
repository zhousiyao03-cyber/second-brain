"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronsLeft, ChevronsRight, List } from "lucide-react";
import { cn } from "@/lib/utils";

interface TocEntry {
  level: number;
  text: string;
  pos: number;
}

function scanHeadings(editor: Editor): TocEntry[] {
  const entries: TocEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text) {
        entries.push({
          level: node.attrs.level as number,
          text,
          pos,
        });
      }
    }
  });
  return entries;
}

interface TocSidebarProps {
  editor: Editor | null;
}

export function TocSidebar({ editor }: TocSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [headings, setHeadings] = useState<TocEntry[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const headingsRef = useRef(headings);
  headingsRef.current = headings;

  const updateHeadings = useCallback(() => {
    if (!editor) return;
    setHeadings(scanHeadings(editor));
  }, [editor]);

  // Track which heading is closest to cursor — reads headings via ref to
  // avoid re-creating this callback (and re-running the effect) on every
  // headings change, which previously caused an infinite render loop.
  const updateActiveHeading = useCallback(() => {
    if (!editor || !headingsRef.current.length) return;

    const { from } = editor.state.selection;
    let closest: TocEntry | null = null;
    for (const h of headingsRef.current) {
      if (h.pos <= from) {
        closest = h;
      }
    }
    setActivePos(closest?.pos ?? null);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    updateHeadings();
    editor.on("update", updateHeadings);
    editor.on("selectionUpdate", updateActiveHeading);

    return () => {
      editor.off("update", updateHeadings);
      editor.off("selectionUpdate", updateActiveHeading);
    };
  }, [editor, updateHeadings, updateActiveHeading]);

  const handleClick = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    },
    [editor]
  );

  if (!editor) return null;

  // Collapsed state: show a small expand button
  if (collapsed) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCollapsed(false)}
          title="Show table of contents"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-48 shrink-0">
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          <List size={14} />
          <span>目录</span>
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCollapsed(true)}
          title="Hide table of contents"
          className="flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      <nav className="space-y-px">
        {headings.length === 0 && (
          <p className="px-2 py-1 text-xs text-stone-400 dark:text-stone-500">
            暂无标题
          </p>
        )}
        {headings.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleClick(h.pos)}
            className={cn(
              "block w-full truncate rounded-md px-2 py-1 text-left text-[13px] leading-relaxed transition-colors",
              h.level === 2 && "pl-5",
              h.level === 3 && "pl-8",
              h.level === 4 && "pl-10",
              h.level === 5 && "pl-12",
              h.level >= 6 && "pl-14",
              activePos === h.pos
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            )}
            title={h.text}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
