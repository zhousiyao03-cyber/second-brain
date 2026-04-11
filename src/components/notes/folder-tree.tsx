"use client";

import { useState, useRef, useEffect } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { trpc } from "@/lib/trpc";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  GripVertical,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { FolderTreeContextMenu } from "./folder-tree-context-menu";

type FolderItem = {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  collapsed: boolean;
  noteCount: number;
};

type FlatNode = FolderItem & { depth: number };

function buildFlatTree(
  folders: FolderItem[],
  parentId: string | null = null,
  depth: number = 0
): FlatNode[] {
  const children = folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const result: FlatNode[] = [];
  for (const child of children) {
    result.push({ ...child, depth });
    if (!child.collapsed) {
      result.push(...buildFlatTree(folders, child.id, depth + 1));
    }
  }
  return result;
}

function hasChildren(folders: FolderItem[], folderId: string): boolean {
  return folders.some((f) => f.parentId === folderId);
}

/** A single folder row that acts as a drop target */
function DroppableFolderRow({
  node,
  isActive,
  expandable,
  onSelect,
  onContextMenu,
  onDoubleClick,
  onToggleCollapse,
  children,
}: {
  node: FlatNode;
  isActive: boolean;
  expandable: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggleCollapse: () => void;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `folder-drop-${node.id}`,
    data: { type: "folder", folderId: node.id },
  });

  const {
    attributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `folder-drag-${node.id}`,
    data: { type: "folder", folderId: node.id, folderName: node.name },
  });

  return (
    <div
      ref={setDropRef}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        isActive
          ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
          : "text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900",
        isOver &&
          "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:ring-blue-500",
        isDragging && "opacity-40"
      )}
      style={{ paddingLeft: 8 + node.depth * 20 }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      {/* Drag handle — only this triggers folder drag */}
      <div
        ref={setDragRef}
        {...attributes}
        {...dragListeners}
        className="shrink-0 cursor-grab rounded p-0.5 text-stone-300 opacity-0 transition-opacity hover:text-stone-500 group-hover:opacity-100 active:cursor-grabbing dark:text-stone-600 dark:hover:text-stone-400"
        style={{ touchAction: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </div>

      {/* Expand/collapse chevron */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (expandable) onToggleCollapse();
        }}
        className={cn(
          "shrink-0 rounded p-0.5 transition-transform",
          expandable
            ? "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
            : "invisible"
        )}
      >
        <ChevronRight
          size={12}
          className={cn(
            "transition-transform",
            !node.collapsed && expandable && "rotate-90"
          )}
        />
      </button>

      {/* Folder icon */}
      {node.icon ? (
        <span className="shrink-0 text-sm">{node.icon}</span>
      ) : isActive ? (
        <FolderOpen size={14} className="shrink-0" />
      ) : (
        <Folder size={14} className="shrink-0" />
      )}

      <span className="min-w-0 flex-1 truncate">{node.name}</span>

      {node.noteCount > 0 && (
        <span className="shrink-0 text-xs text-stone-400">
          {node.noteCount}
        </span>
      )}

      {children}
    </div>
  );
}

interface FolderTreeProps {
  activeFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
}

export function FolderTree({
  activeFolderId,
  onSelectFolder,
  onCreateNote,
}: FolderTreeProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: folderData = [] } = trpc.folders.list.useQuery();
  const flatNodes = buildFlatTree(folderData);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    folderId: string;
  } | null>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // New folder input state
  const [creatingIn, setCreatingIn] = useState<string | null | undefined>(
    undefined
  );
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (creatingIn !== undefined && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingIn]);

  const toggleCollapse = trpc.folders.toggleCollapse.useMutation({
    onSuccess: () => utils.folders.list.invalidate(),
  });
  const createFolder = trpc.folders.create.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      setCreatingIn(undefined);
      setNewFolderName("");
      toast("Folder created", "success");
    },
  });
  const renameFolder = trpc.folders.rename.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      setRenamingId(null);
    },
  });
  const deleteFolder = trpc.folders.delete.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      utils.notes.list.invalidate();
      if (activeFolderId && activeFolderId !== "") {
        onSelectFolder(null);
      }
      toast("Folder deleted", "success");
    },
  });

  const handleContextMenu = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folderId });
  };

  const startRename = (folderId: string) => {
    const folder = folderData.find((f) => f.id === folderId);
    if (folder) {
      setRenamingId(folderId);
      setRenameValue(folder.name);
    }
  };

  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      renameFolder.mutate({ id: renamingId, name: renameValue.trim() });
    } else {
      setRenamingId(null);
    }
  };

  const confirmNewFolder = () => {
    if (newFolderName.trim() && creatingIn !== undefined) {
      createFolder.mutate({
        name: newFolderName.trim(),
        parentId: creatingIn,
      });
    } else {
      setCreatingIn(undefined);
      setNewFolderName("");
    }
  };

  const staticItemClass = (isActive: boolean) =>
    cn(
      "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors cursor-pointer",
      isActive
        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
        : "text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900"
    );

  // Droppable "root" target — dropping a folder here moves it to top-level
  const {
    isOver: isOverRoot,
    setNodeRef: setRootDropRef,
  } = useDroppable({
    id: "folder-drop-root",
    data: { type: "folder-root" },
  });

  return (
    <div className="space-y-0.5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
          Explorer
        </h2>
        <button
          onClick={() => {
            setCreatingIn(null);
            setNewFolderName("");
          }}
          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* All notes — also acts as drop target for moving folders/notes to root */}
      <div
        ref={setRootDropRef}
        onClick={() => onSelectFolder(null)}
        className={cn(
          staticItemClass(activeFolderId === null),
          isOverRoot &&
            "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:ring-blue-500"
        )}
      >
        <FileText size={14} className="shrink-0" />
        <span className="flex-1 truncate">All notes</span>
      </div>

      {/* Unfiled */}
      <button
        onClick={() => onSelectFolder("")}
        className={staticItemClass(activeFolderId === "")}
      >
        <FileText size={14} className="shrink-0" />
        <span className="flex-1 truncate">Unfiled</span>
      </button>

      {flatNodes.length > 0 && (
        <div className="my-1.5 border-t border-stone-200 dark:border-stone-700" />
      )}

      {/* Folder tree nodes */}
      {flatNodes.map((node) => {
        const isActive = activeFolderId === node.id;
        const expandable = hasChildren(folderData, node.id);

        if (renamingId === node.id) {
          return (
            <div
              key={node.id}
              className="flex items-center gap-1.5 px-2 py-1"
              style={{ paddingLeft: 8 + node.depth * 20 }}
            >
              <Folder size={14} className="shrink-0 text-stone-400" />
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={confirmRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm outline-none dark:border-blue-500 dark:bg-stone-900"
              />
            </div>
          );
        }

        return (
          <DroppableFolderRow
            key={node.id}
            node={node}
            isActive={isActive}
            expandable={expandable}
            onSelect={() => onSelectFolder(node.id)}
            onContextMenu={(e) => handleContextMenu(e, node.id)}
            onDoubleClick={() => startRename(node.id)}
            onToggleCollapse={() => toggleCollapse.mutate({ id: node.id })}
          >
            {/* More button on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                setContextMenu({
                  x: rect.right,
                  y: rect.bottom,
                  folderId: node.id,
                });
              }}
              className="shrink-0 rounded p-0.5 text-stone-400 opacity-0 transition-opacity hover:text-stone-600 group-hover:opacity-100 dark:hover:text-stone-300"
            >
              <MoreHorizontal size={14} />
            </button>
          </DroppableFolderRow>
        );
      })}

      {/* New folder input */}
      {creatingIn !== undefined && (
        <div
          className="flex items-center gap-1.5 px-2 py-1"
          style={{
            paddingLeft:
              creatingIn === null
                ? 8
                : 8 +
                  ((flatNodes.find((n) => n.id === creatingIn)?.depth ?? 0) +
                    1) *
                    20,
          }}
        >
          <FolderPlus size={14} className="shrink-0 text-blue-500" />
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={confirmNewFolder}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmNewFolder();
              if (e.key === "Escape") {
                setCreatingIn(undefined);
                setNewFolderName("");
              }
            }}
            placeholder="Folder name..."
            className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm outline-none placeholder:text-stone-400 dark:border-blue-500 dark:bg-stone-900"
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <FolderTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onNewNote={() => onCreateNote(contextMenu.folderId)}
          onNewSubfolder={() => {
            setCreatingIn(contextMenu.folderId);
            setNewFolderName("");
          }}
          onRename={() => startRename(contextMenu.folderId)}
          onDelete={() => {
            if (confirm("Delete this folder? Notes will be moved to parent.")) {
              deleteFolder.mutate({ id: contextMenu.folderId });
            }
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
