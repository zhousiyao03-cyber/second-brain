"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";

export default function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = use(searchParams);
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "approving" | "done" | "error">("idle");

  if (!session_id) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Invalid Request</h1>
          <p className="mt-2 text-muted-foreground">
            This page should be opened from the Knosi CLI.
            Run <code className="rounded bg-muted px-1.5 py-0.5 text-sm">knosi login</code> to start.
          </p>
        </div>
      </div>
    );
  }

  async function handleApprove() {
    setStatus("approving");
    try {
      const res = await fetch("/api/cli/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to authorize");
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-2xl font-bold">CLI Authorized</h1>
          <p className="mt-2 text-muted-foreground">
            You can close this tab and return to your terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center shadow-sm">
        <div className="text-4xl mb-4">🔐</div>
        <h1 className="text-2xl font-bold">Authorize Knosi CLI</h1>
        <p className="mt-3 text-muted-foreground">
          The Knosi CLI is requesting access to your account.
          This will allow the CLI daemon to process AI tasks on your behalf.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <button
            onClick={() => router.back()}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={status === "approving"}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === "approving" ? "Authorizing..." : "Authorize"}
          </button>
        </div>
        {status === "error" && (
          <p className="mt-4 text-sm text-destructive">
            Authorization failed. The session may have expired — try running{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">knosi login</code> again.
          </p>
        )}
      </div>
    </div>
  );
}
