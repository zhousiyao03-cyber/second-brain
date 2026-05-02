"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ProviderEditDialog, type ProviderKind } from "./provider-edit-dialog";

type Provider = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

export function ProviderCard({ p }: { p: Provider }) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const test = trpc.aiSettings.testProvider.useMutation();
  const del = trpc.aiSettings.deleteProvider.useMutation();

  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await test.mutateAsync({ id: p.id });
      setTestMsg(
        r.ok
          ? `OK — ${r.models.length} models available.`
          : `Failed: ${r.error}`,
      );
    } finally {
      setTesting(false);
    }
  }

  async function runDelete() {
    if (!confirm(`Delete provider "${p.label}"?`)) return;
    try {
      await del.mutateAsync({ id: p.id });
      await utils.aiSettings.listProviders.invalidate();
      await utils.aiSettings.getRoleAssignments.invalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{p.label}</div>
          <div className="text-xs text-stone-500 truncate">
            {p.kind}
            {p.baseUrl ? ` · ${p.baseUrl}` : ""}
            {p.hasApiKey ? " · key set" : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            onClick={runTest}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            className="rounded border px-2 py-1 text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            className="rounded border px-2 py-1 text-xs text-red-700"
            onClick={runDelete}
          >
            Delete
          </button>
        </div>
      </div>
      {testMsg && <div className="mt-2 text-xs">{testMsg}</div>}
      {editing && (
        <ProviderEditDialog existing={p} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
