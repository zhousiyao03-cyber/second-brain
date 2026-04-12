"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Rows3,
  Columns3,
  TableProperties,
} from "lucide-react";

/** Reusable button matching BubbleToolbar styling */
function TableToolbarButton({
  onClick,
  isActive,
  children,
  title,
  danger,
}: {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent losing editor focus
        onClick();
      }}
      title={title}
      className={cn(
        "p-1.5 rounded transition-colors",
        danger
          ? "hover:bg-red-500/30 hover:text-red-300"
          : "hover:bg-white/20",
        isActive && "bg-white/20 text-white"
      )}
    >
      {children}
    </button>
  );
}

interface TableToolbarProps {
  editor: Editor;
}

/**
 * Floating toolbar that appears when the cursor is inside a table.
 * Provides buttons for common table operations (add/delete rows/columns,
 * toggle header row, delete table).
 */
export function TableToolbar({ editor }: TableToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    // Only show when cursor is inside a table
    if (!editor.isActive("table")) {
      setVisible(false);
      return;
    }

    // Find the table DOM element containing the current selection
    const { from } = editor.state.selection;
    const domAtPos = editor.view.domAtPos(from);
    const tableElement = (domAtPos.node instanceof HTMLElement
      ? domAtPos.node
      : domAtPos.node.parentElement
    )?.closest("table");

    if (!tableElement) {
      setVisible(false);
      return;
    }

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const tableRect = tableElement.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 360;

    // Center horizontally above the table
    let left = tableRect.left + tableRect.width / 2 - toolbarWidth / 2;
    // Keep within viewport
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));

    // Position above the table with some spacing
    const top = tableRect.top - 50;

    setPosition({ top, left });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
    };
  }, [editor, updatePosition]);

  const iconSize = 15;

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "fixed z-50 flex items-center gap-0.5 rounded-xl border border-stone-800/80 bg-stone-950/95 px-1.5 py-1 shadow-xl backdrop-blur transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      style={{ top: position.top, left: position.left }}
    >
      {/* Add row above */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().addRowBefore().run()}
        title="Insert row above"
      >
        <div className="relative">
          <Rows3 size={iconSize} className="text-gray-300" />
          <Plus
            size={8}
            className="absolute -top-1 -right-1 text-gray-400"
            strokeWidth={3}
          />
        </div>
      </TableToolbarButton>

      {/* Add row below */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().addRowAfter().run()}
        title="Insert row below"
      >
        <div className="relative">
          <Rows3 size={iconSize} className="text-gray-300" />
          <Plus
            size={8}
            className="absolute -bottom-1 -right-1 text-gray-400"
            strokeWidth={3}
          />
        </div>
      </TableToolbarButton>

      <div className="mx-0.5 h-4 w-px bg-stone-700" />

      {/* Add column before */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        title="Insert column left"
      >
        <div className="relative">
          <Columns3 size={iconSize} className="text-gray-300" />
          <Plus
            size={8}
            className="absolute -top-1 -left-1 text-gray-400"
            strokeWidth={3}
          />
        </div>
      </TableToolbarButton>

      {/* Add column after */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        title="Insert column right"
      >
        <div className="relative">
          <Columns3 size={iconSize} className="text-gray-300" />
          <Plus
            size={8}
            className="absolute -top-1 -right-1 text-gray-400"
            strokeWidth={3}
          />
        </div>
      </TableToolbarButton>

      <div className="mx-0.5 h-4 w-px bg-stone-700" />

      {/* Delete row */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().deleteRow().run()}
        title="Delete row"
        danger
      >
        <Rows3 size={iconSize} className="text-gray-300" />
      </TableToolbarButton>

      {/* Delete column */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().deleteColumn().run()}
        title="Delete column"
        danger
      >
        <Columns3 size={iconSize} className="text-gray-300" />
      </TableToolbarButton>

      <div className="mx-0.5 h-4 w-px bg-stone-700" />

      {/* Toggle header row */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        title="Toggle header row"
      >
        <TableProperties size={iconSize} className="text-gray-300" />
      </TableToolbarButton>

      {/* Delete table */}
      <TableToolbarButton
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="Delete table"
        danger
      >
        <Trash2 size={iconSize} className="text-gray-300" />
      </TableToolbarButton>
    </div>
  );
}
