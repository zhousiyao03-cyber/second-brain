"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Bookmark,
  CheckSquare,
  GraduationCap,
  Compass,
  MessageCircle,
  Workflow,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/bookmarks", label: "收藏", icon: Bookmark },
  { href: "/todos", label: "Todo", icon: CheckSquare },
  { href: "/learn", label: "学习", icon: GraduationCap },
  { href: "/explore", label: "AI 探索", icon: Compass },
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
  { href: "/workflows", label: "工作流", icon: Workflow },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">🧠 Second Brain</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
