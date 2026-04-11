"use client";

import { useState } from "react";
import { FolderTree } from "./folder-tree";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import {
  FolderTree as FolderTreeIcon,
  Search,
  Tag,
  Link2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarTab = "tree" | "search" | "tags" | "backlinks";

interface NotesSidebarProps {
  activeFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  activeNoteId?: string | null;
}

function SearchPanel() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const { data: results = [] } = trpc.notes.searchByTitle.useQuery(
    { query },
    { enabled: query.length > 0, staleTime: 5000 }
  );

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Search notes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      />
      {results.map((note) => (
        <button
          key={note.id}
          onClick={() => router.push(`/notes/${note.id}`)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-stone-600 transition-colors hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900"
        >
          {note.icon ? (
            <span className="shrink-0 text-sm">{note.icon}</span>
          ) : (
            <FileText size={14} className="shrink-0 text-stone-400" />
          )}
          <span className="truncate">{note.title || "Untitled"}</span>
        </button>
      ))}
      {query && results.length === 0 && (
        <p className="px-2 text-xs text-stone-400">No results</p>
      )}
    </div>
  );
}

function TagsPanel() {
  const { data: sortedTags = [] } = trpc.notes.listTags.useQuery();

  if (sortedTags.length === 0) {
    return <p className="px-2 text-xs text-stone-400">No tags yet</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sortedTags.map((t) => (
        <span
          key={t.name}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
        >
          {t.name}
          <span className="text-blue-400">{t.count}</span>
        </span>
      ))}
    </div>
  );
}

function BacklinksTab({ noteId }: { noteId: string }) {
  const router = useRouter();
  const { data: backlinks = [] } = trpc.notes.backlinks.useQuery(
    { noteId },
    { enabled: !!noteId, staleTime: 15000 }
  );

  if (!noteId) {
    return (
      <p className="px-2 text-xs text-stone-400">
        Open a note to see backlinks
      </p>
    );
  }

  if (backlinks.length === 0) {
    return <p className="px-2 text-xs text-stone-400">No backlinks</p>;
  }

  return (
    <div className="space-y-1">
      {backlinks.map((link) => (
        <button
          key={link.sourceNoteId}
          onClick={() => router.push(`/notes/${link.sourceNoteId}`)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-stone-600 transition-colors hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900"
        >
          {link.sourceIcon ? (
            <span className="shrink-0 text-sm">{link.sourceIcon}</span>
          ) : (
            <FileText size={14} className="shrink-0 text-stone-400" />
          )}
          <span className="truncate">{link.sourceTitle || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}

export function NotesSidebar({
  activeFolderId,
  onSelectFolder,
  onCreateNote,
  activeNoteId,
}: NotesSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("tree");

  const tabs: Array<{ id: SidebarTab; icon: typeof FolderTreeIcon; label: string }> = [
    { id: "tree", icon: FolderTreeIcon, label: "Files" },
    { id: "search", icon: Search, label: "Search" },
    { id: "tags", icon: Tag, label: "Tags" },
    { id: "backlinks", icon: Link2, label: "Links" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="mb-3 flex border-b border-stone-200 dark:border-stone-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs transition-colors",
              activeTab === tab.id
                ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
                : "border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
            )}
            title={tab.label}
          >
            <tab.icon size={14} />
            <span className="hidden xl:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "tree" && (
          <FolderTree
            activeFolderId={activeFolderId}
            onSelectFolder={onSelectFolder}
            onCreateNote={onCreateNote}
          />
        )}
        {activeTab === "search" && <SearchPanel />}
        {activeTab === "tags" && <TagsPanel />}
        {activeTab === "backlinks" && (
          <BacklinksTab noteId={activeNoteId ?? ""} />
        )}
      </div>
    </div>
  );
}
