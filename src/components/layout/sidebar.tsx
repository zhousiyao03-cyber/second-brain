"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import { logout } from "@/app/(app)/actions";
import { AppBrand } from "./app-brand";
import { navigationGroups } from "./navigation";
import { clientFeatureFlags } from "@/lib/feature-flags";

const COLLAPSED_COOKIE = "sb_collapsed";

export function Sidebar({
  initialCollapsed = false,
}: {
  workspaceLabel?: string;
  initialCollapsed?: boolean;
}) {
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
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      const shell = document.querySelector<HTMLElement>("[data-app-shell]");
      if (shell) {
        shell.style.setProperty("--app-sidebar-w", next ? "68px" : "15rem");
      }
      return next;
    });
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "group/sidebar hidden h-full shrink-0 flex-col border-r border-stone-200/70 bg-stone-50/80 backdrop-blur-xs transition-[width] duration-300 ease-out md:flex dark:border-stone-800/80 dark:bg-stone-950/70",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 pt-4 pb-4",
          collapsed && "flex-col gap-3"
        )}
      >
        <div className={cn("min-w-0 flex-1", collapsed && "flex-none")}>
          <AppBrand compact={collapsed} />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 opacity-0 transition-all hover:bg-stone-200/70 hover:text-stone-700 focus:opacity-100 group-hover/sidebar:opacity-100 group-data-[collapsed=true]/sidebar:opacity-100 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 pt-1">
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !item.featureFlag || clientFeatureFlags[item.featureFlag]
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.label}>
              {collapsed ? (
                <div className="mx-auto my-1 h-px w-6 bg-stone-200/60 dark:bg-stone-800/60" />
              ) : (
                <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-label={item.label}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center rounded-lg text-[13px] font-medium transition-colors",
                        collapsed ? "h-9 justify-center" : "gap-2.5 px-3 py-2",
                        isActive
                          ? "bg-stone-200/70 text-stone-900 dark:bg-stone-800/80 dark:text-stone-100"
                          : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100"
                      )}
                    >
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-stone-900 dark:bg-stone-100" />
                      )}
                      <Icon
                        className={cn(
                          "h-[16px] w-[16px] shrink-0",
                          isActive ? "text-stone-900 dark:text-stone-100" : ""
                        )}
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: icon-only utility row */}
      <div
        className={cn(
          "mt-2 flex gap-1 px-3 pt-3 pb-4",
          collapsed ? "flex-col items-center" : "items-center justify-start"
        )}
      >
        <Link
          href="/settings"
          aria-label="Account settings"
          title="Account settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-100"
        >
          <Settings className="h-[15px] w-[15px]" strokeWidth={1.8} />
        </Link>
        <button
          type="button"
          onClick={toggleDark}
          aria-label={dark ? "Light mode" : "Dark mode"}
          title={dark ? "Light mode" : "Dark mode"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-100"
        >
          {dark ? (
            <Sun className="h-[15px] w-[15px]" strokeWidth={1.8} />
          ) : (
            <Moon className="h-[15px] w-[15px]" strokeWidth={1.8} />
          )}
        </button>
        <form action={logout} className="contents">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-100"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </form>
      </div>
    </aside>
  );
}
