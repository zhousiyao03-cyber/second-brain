"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Moon, Search, Settings, Sun, X } from "lucide-react";
import { logout } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";
import { AppBrand } from "./app-brand";
import { navigationItems } from "./navigation";
import type { NavItem } from "./navigation";
import { clientFeatureFlags } from "@/lib/feature-flags";

function useDarkModeState() {
  return useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      return true;
    }
    return false;
  });
}

export function MobileNav({
  workspaceLabel = "Workspace",
}: {
  workspaceLabel?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useDarkModeState();

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const openSearch = () => {
    setOpen(false);
    window.dispatchEvent(new Event("second-brain:open-search"));
  };

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200/80 bg-stone-50/92 px-4 py-3 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/88">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          <Menu className="h-5 w-5" />
        </button>

        <AppBrand compact className="gap-2" />

        <button
          type="button"
          aria-label="Open search"
          onClick={openSearch}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-stone-950/45"
          />

          <div className="absolute inset-y-0 left-0 flex w-[84vw] max-w-sm flex-col border-r border-stone-200 bg-stone-50 px-4 py-4 shadow-2xl dark:border-stone-800 dark:bg-stone-950">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <AppBrand />
                <div className="mt-2 truncate pl-1 text-[11px] font-medium uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
                  {workspaceLabel}
                </div>
              </div>

              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={openSearch}
              className="mb-4 flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <Search className="h-4 w-4" />
              Search
            </button>

            <nav className="flex-1 space-y-1">
              {navigationItems
                .filter((item: NavItem) => !item.featureFlag || clientFeatureFlags[item.featureFlag])
                .map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                      isActive
                        ? "bg-white text-stone-900 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)] ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-800"
                        : "text-stone-600 hover:bg-white hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 space-y-2 border-t border-stone-200 pt-4 dark:border-stone-800">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                <Settings className="h-4 w-4" />
                Account settings
              </Link>
              <button
                type="button"
                onClick={toggleDark}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {dark ? "Light mode" : "Dark mode"}
              </button>

              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
