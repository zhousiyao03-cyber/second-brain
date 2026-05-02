"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  LOCAL_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE_PRESETS,
} from "@/server/ai/provider/presets";

export type ProviderKind =
  | "openai-compatible"
  | "local"
  | "claude-code-daemon"
  | "transformers";

type Existing = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

export function ProviderEditDialog({
  existing,
  initialKind,
  onClose,
}: {
  existing: Existing | null;
  initialKind?: ProviderKind;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const isEdit = existing !== null;
  const startingKind: ProviderKind = existing?.kind ?? initialKind ?? "openai-compatible";
  const [kind, setKind] = useState<ProviderKind>(startingKind);
  const [presetId, setPresetId] = useState<string>(
    startingKind === "openai-compatible" ? "openai" : "custom",
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(
    existing?.baseUrl ?? (kind === "local" ? LOCAL_DEFAULT_BASE_URL : ""),
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = trpc.aiSettings.addProvider.useMutation();
  const update = trpc.aiSettings.updateProvider.useMutation();
  const test = trpc.aiSettings.testProvider.useMutation();

  useEffect(() => {
    if (kind !== "openai-compatible" || presetId === "custom") return;
    const p = OPENAI_COMPATIBLE_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setBaseUrl(p.baseUrl);
    if (!isEdit && !label) setLabel(p.label);
  }, [kind, presetId, isEdit, label]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let id: string;
      if (isEdit) {
        await update.mutateAsync({
          id: existing.id,
          label: label.trim() || undefined,
          baseUrl:
            kind === "claude-code-daemon" || kind === "transformers"
              ? null
              : baseUrl,
          apiKey: apiKey ? apiKey : undefined,
        });
        id = existing.id;
      } else {
        const res = await add.mutateAsync({
          kind,
          label: label.trim(),
          baseUrl:
            kind === "claude-code-daemon" || kind === "transformers"
              ? null
              : baseUrl,
          apiKey: kind === "openai-compatible" ? apiKey : null,
        });
        id = res.id;
      }
      const r = await test.mutateAsync({ id });
      if (!r.ok) {
        setError(`Saved, but connection test failed: ${r.error}`);
        await utils.aiSettings.listProviders.invalidate();
        setBusy(false);
        return;
      }
      await utils.aiSettings.listProviders.invalidate();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-2xl bg-white p-5 dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">
          {isEdit ? "Edit provider" : "Add provider"}
        </h3>

        {!isEdit && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Kind</label>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={kind}
              onChange={(e) => setKind(e.target.value as ProviderKind)}
            >
              <option value="openai-compatible">OpenAI-compatible API</option>
              <option value="local">Local Model (Ollama / LM Studio)</option>
              <option value="claude-code-daemon">Claude Code Daemon</option>
              <option value="transformers">
                Transformers.js (in-process embedding)
              </option>
            </select>
          </div>
        )}

        {kind === "openai-compatible" && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Preset</label>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>
        )}

        {(kind === "openai-compatible" || kind === "local") && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Base URL</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>
        )}

        {kind === "openai-compatible" && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">API Key</label>
            <input
              type="password"
              className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? "(leave blank to keep existing)" : "sk-..."}
            />
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-medium uppercase">Label</label>
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded border px-3 py-1"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
            onClick={save}
            disabled={busy || !label.trim()}
          >
            {busy ? "Saving…" : "Test & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
