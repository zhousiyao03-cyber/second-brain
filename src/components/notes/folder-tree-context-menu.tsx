"use client";

import { useEffect, useRef } from "react";
import {
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  onNewNote: () => void;
  onNewSubfolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function FolderTreeContextMenu({
  x,
  y,
  onNewNote,
  onNewSubfolder,
  onRename,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const items = [
    { icon: FilePlus, label: "New note here", action: onNewNote },
    { icon: FolderPlus, label: "New subfolder", action: onNewSubfolder },
    { icon: Pencil, label: "Rename", action: onRename },
    { icon: Trash2, label: "Delete", action: onDelete, danger: true },
  ];

  // Clamp to viewport bounds
  const menuWidth = 160;
  const menuHeight = 140;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.action();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
            item.danger
              ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          }`}
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
