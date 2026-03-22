"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, FileText } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export default function NotesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const utils = trpc.useUtils();
  const { data: notes = [], isLoading } = trpc.notes.list.useQuery();
  const createNote = trpc.notes.create.useMutation({
    onSuccess: (data) => {
      utils.notes.list.invalidate();
      router.push(`/notes/${data.id}`);
    },
  });
  const { toast } = useToast();
  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
      toast("已删除笔记", "success");
    },
  });

  const filtered = notes.filter((note) => {
    const matchesSearch =
      !search ||
      note.title.toLowerCase().includes(search.toLowerCase()) ||
      note.plainText?.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || note.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const handleCreate = () => {
    createNote.mutate({ title: "无标题笔记" });
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("确定删除这条笔记吗？")) {
      deleteNote.mutate({ id });
    }
  };

  const typeLabels: Record<string, string> = {
    note: "笔记",
    journal: "日记",
    summary: "总结",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">笔记</h1>
        <button
          onClick={handleCreate}
          disabled={createNote.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Plus size={16} />
          新建笔记
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜索笔记..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部类型</option>
          <option value="note">笔记</option>
          <option value="journal">日记</option>
          <option value="summary">总结</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm">加载中...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText size={48} className="mx-auto mb-3 opacity-50" />
          <p>{notes.length === 0 ? "还没有笔记，点击新建开始吧" : "没有匹配的笔记"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((note) => {
            const tags: string[] = note.tags ? JSON.parse(note.tags) : [];
            return (
              <div
                key={note.id}
                onClick={() => router.push(`/notes/${note.id}`)}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {note.title}
                    </h3>
                    {note.type && note.type !== "note" && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                        {typeLabels[note.type] ?? note.type}
                      </span>
                    )}
                  </div>
                  {note.plainText && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                      {note.plainText.slice(0, 80)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">
                      {formatDate(note.updatedAt)}
                    </span>
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, note.id)}
                  className={cn(
                    "p-2 text-gray-400 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all"
                  )}
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
