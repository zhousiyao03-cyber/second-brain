"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  FileText,
  Bookmark,
  CheckSquare,
  GraduationCap,
  ArrowRight,
} from "lucide-react";

const statCards = [
  { key: "notes" as const, label: "笔记", icon: FileText, href: "/notes", color: "text-blue-600 bg-blue-50" },
  { key: "bookmarks" as const, label: "收藏", icon: Bookmark, href: "/bookmarks", color: "text-orange-600 bg-orange-50" },
  { key: "todos" as const, label: "待办", icon: CheckSquare, href: "/todos", color: "text-green-600 bg-green-50" },
  { key: "learningPaths" as const, label: "学习路径", icon: GraduationCap, href: "/learn", color: "text-purple-600 bg-purple-50" },
];

export default function DashboardPage() {
  const { data, isLoading } = trpc.dashboard.stats.useQuery();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">首页</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${card.color}`}>
              <card.icon size={16} />
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {isLoading ? "-" : (data?.counts[card.key] ?? 0)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{card.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Recent notes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">最近笔记</h2>
            <Link href="/notes" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-xs text-gray-400">加载中...</p>
            ) : data?.recentNotes.length === 0 ? (
              <p className="text-xs text-gray-400">暂无笔记</p>
            ) : (
              data?.recentNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="block p-3 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {note.title}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {note.updatedAt
                      ? new Date(note.updatedAt).toLocaleDateString("zh-CN", {
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent bookmarks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">最近收藏</h2>
            <Link href="/bookmarks" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-xs text-gray-400">加载中...</p>
            ) : data?.recentBookmarks.length === 0 ? (
              <p className="text-xs text-gray-400">暂无收藏</p>
            ) : (
              data?.recentBookmarks.map((bm) => (
                <Link
                  key={bm.id}
                  href="/bookmarks"
                  className="block p-3 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {bm.title ?? bm.url ?? "无标题"}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {bm.createdAt
                      ? new Date(bm.createdAt).toLocaleDateString("zh-CN", {
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Pending todos */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              待办事项
              {data && data.counts.todosDone > 0 && (
                <span className="ml-1 text-green-600">
                  ({data.counts.todosDone} 已完成)
                </span>
              )}
            </h2>
            <Link href="/todos" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-xs text-gray-400">加载中...</p>
            ) : data?.pendingTodos.length === 0 ? (
              <p className="text-xs text-gray-400">没有待办事项</p>
            ) : (
              data?.pendingTodos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-2 p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
                >
                  <CheckSquare size={14} className="text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
                    {todo.title}
                  </span>
                  {todo.priority === "high" && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                      高
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
