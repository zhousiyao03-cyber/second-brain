"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { logout } from "@/app/(app)/actions";
import { navigationItems } from "./navigation";

export function Sidebar() {
  const pathname = usePathname();
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      return true;
    }
    return false;
  });

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const openSearch = () => {
    window.dispatchEvent(new Event("second-brain:open-search"));
  };

  return (
    <aside className="hidden h-full w-64 shrink-0 border-r border-stone-200/80 bg-stone-50/92 px-3 py-3 md:flex md:flex-col dark:border-stone-800 dark:bg-stone-950/88">
      <div className="rounded-[20px] px-2 pb-4">
        <div className="flex items-center gap-3 rounded-[18px] px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-200 text-sm font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            S
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
              Second Brain
            </div>
            <div className="truncate text-xs text-stone-500 dark:text-stone-400">
              Personal workspace
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-500 transition-colors hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
      >
        <Search className="h-4 w-4" />
        搜索
        <span className="ml-auto rounded-md border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-400 dark:border-stone-700 dark:text-stone-500">
          Cmd K
        </span>
      </button>

      <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
        Workspace
      </div>

      <nav className="flex-1 space-y-1">
        {navigationItems.map((item) => {
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
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                isActive
                  ? "bg-white text-stone-900 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)] ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-800"
                  : "text-stone-600 hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 border-t border-stone-200 px-2 pt-4 dark:border-stone-800">
        <Link
          href="/settings"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          <Settings className="h-4 w-4" />
          账号设置
        </Link>
        <button
          onClick={toggleDark}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "浅色模式" : "深色模式"}
        </button>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
          >
            <LogOut className="h-4 w-4" />
            登出
          </button>
        </form>
      </div>
    </aside>
  );
}
