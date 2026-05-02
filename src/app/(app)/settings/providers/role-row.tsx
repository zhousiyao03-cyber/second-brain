"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  DAEMON_PRESET_MODELS,
  LOCAL_PRESET_MODELS,
  OPENAI_COMPATIBLE_PRESETS,
  TRANSFORMERS_PRESET_MODELS,
} from "@/server/ai/provider/presets";
import type { ProviderKind } from "./provider-edit-dialog";

type Role = "chat" | "task" | "embedding";

type Provider = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

function presetModelsFor(p: Provider): readonly string[] {
  if (p.kind === "openai-compatible") {
    const preset = OPENAI_COMPATIBLE_PRESETS.find((x) =>
      p.baseUrl?.startsWith(x.baseUrl),
    );
    return preset?.models ?? [];
  }
  if (p.kind === "local") return LOCAL_PRESET_MODELS;
  if (p.kind === "claude-code-daemon") return DAEMON_PRESET_MODELS;
  return TRANSFORMERS_PRESET_MODELS;
}

const CUSTOM = "__custom__";

export function RoleRow({
  role,
  providers,
  current,
  description,
}: {
  role: Role;
  providers: Provider[];
  current: { providerId: string; modelId: string } | null;
  description: string;
}) {
  const utils = trpc.useUtils();
  const set = trpc.aiSettings.setRoleAssignment.useMutation({
    onSuccess: () => utils.aiSettings.getRoleAssignments.invalidate(),
  });

  const eligible = providers.filter((p) => {
    if (role === "embedding") return p.kind !== "claude-code-daemon";
    return p.kind !== "transformers";
  });

  const [providerId, setProviderId] = useState(
    current?.providerId ?? eligible[0]?.id ?? "",
  );
  const [modelId, setModelId] = useState(current?.modelId ?? "");
  const [customModel, setCustomModel] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (current) {
      setProviderId(current.providerId);
      setModelId(current.modelId);
    }
  }, [current?.providerId, current?.modelId]);

  const selectedProvider = eligible.find((p) => p.id === providerId);
  const presets = selectedProvider ? presetModelsFor(selectedProvider) : [];
  const live = trpc.aiSettings.listProviderModels.useQuery(
    { id: providerId, refresh: false },
    { enabled: Boolean(providerId), staleTime: 60_000 },
  );
  const allModels = Array.from(
    new Set([...presets, ...(live.data?.models ?? [])]),
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await live.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  async function save() {
    const finalModel = modelId === CUSTOM ? customModel.trim() : modelId.trim();
    if (!providerId || !finalModel) return;
    await set.mutateAsync({ role, providerId, modelId: finalModel });
  }

  return (
    <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex items-baseline justify-between">
        <div className="font-medium capitalize">{role}</div>
        <div className="text-xs text-stone-500">{description}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="rounded border px-2 py-1 text-sm"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          <option value="">— select provider —</option>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="rounded border px-2 py-1 text-sm font-mono"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        >
          <option value="">— select model —</option>
          {allModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {modelId === CUSTOM && (
          <input
            className="rounded border px-2 py-1 text-sm font-mono"
            placeholder="custom model id"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        )}
        <button
          className="rounded border px-2 py-1 text-xs"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "↻" : "Refresh"}
        </button>
        <button
          className="rounded bg-stone-900 px-2 py-1 text-xs text-white dark:bg-stone-100 dark:text-stone-900"
          onClick={() => void save()}
          disabled={set.isPending}
        >
          {set.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
