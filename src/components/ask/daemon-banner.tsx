"use client";

import { useEffect, useState } from "react";

interface DaemonStatus {
  online: boolean;
  lastSeenAt: string | null;
  secondsSince: number | null;
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return "Never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function DaemonBanner() {
  const [statusData, setStatusData] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/daemon/status?kind=chat");
        if (!res.ok) return;
        const data = (await res.json()) as DaemonStatus;
        if (!cancelled) setStatusData(data);
      } catch {
        // ignore — banner just stays hidden
      }
    }

    refresh();
    const id = setInterval(refresh, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!statusData || statusData.online) {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <strong>Local Claude daemon not running</strong> — Requires Claude CLI. Run{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/60">pnpm usage:daemon</code> locally.
      Last heartbeat: {formatAge(statusData.secondsSince)}
    </div>
  );
}
