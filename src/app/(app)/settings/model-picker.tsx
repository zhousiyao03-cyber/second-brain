"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";

type ProviderValue =
  | "knosi-hosted"
  | "claude-code-daemon"
  | "openai"
  | "local"
  | "cursor";

/**
 * Curated model presets per provider. Free text is still allowed via the
 * "Custom..." input — these are just convenience radios. Spec §3.5.
 *
 * Cursor presets are tentative — Phase B will recurate from the real
 * `/v1/models` response after the proxy is deployed (spec §5).
 */
const PRESET_MODELS: Record<ProviderValue, readonly string[]> = {
  openai: ["gpt-5.4", "gpt-4o", "gpt-4o-mini", "o1-mini"],
  "knosi-hosted": ["gpt-5.4", "gpt-4o"],
  "claude-code-daemon": ["claude-sonnet-4-6", "claude-opus-4-7"],
  local: ["qwen2.5:14b", "llama3.2", "mistral-nemo"],
  cursor: [
    "claude-4.6-sonnet-medium",
    "claude-4.6-opus-high",
    "claude-opus-4-7-thinking-xhigh",
    "gpt-5.5-medium",
    "gpt-5.5-high",
  ],
} as const;

const EMPTY_PRESETS: readonly string[] = [];

const DEFAULT_VALUE = "__deployment_default__";
const CUSTOM_VALUE = "__custom__";

export function ModelPicker({ provider }: { provider: ProviderValue }) {
  const utils = trpc.useUtils();
  const { data: current, isLoading } = trpc.billing.getAiChatModel.useQuery();
  const setModel = trpc.billing.setAiChatModel.useMutation({
    onSuccess: () => utils.billing.getAiChatModel.invalidate(),
  });

  const presets = PRESET_MODELS[provider] ?? EMPTY_PRESETS;
  const isPresetMatch = Boolean(current && presets.includes(current));

  // Two interaction states:
  //   - "showCustomInput" controls whether the inline text input is visible.
  //     Toggled by clicking the "Custom…" radio. Stays open across renders
  //     once the user opted in, regardless of what `current` is.
  //   - "customDraft" is the in-flight value the user is typing before
  //     they hit Save / Enter. We seed it from `current` whenever Custom
  //     is opened.
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customDraft, setCustomDraft] = useState<string>("");

  // Derive which radio is checked. If the user explicitly opened the
  // Custom input, force the Custom radio. Otherwise reflect what the
  // server says — preset hit -> that preset, free text -> Custom radio,
  // null -> deployment default.
  const radio: string = showCustomInput
    ? CUSTOM_VALUE
    : current
      ? isPresetMatch
        ? current
        : CUSTOM_VALUE
      : DEFAULT_VALUE;

  const selectPreset = useCallback(
    async (value: string) => {
      setShowCustomInput(false);
      await setModel.mutateAsync({ model: value });
    },
    [setModel],
  );

  const selectDeploymentDefault = useCallback(async () => {
    setShowCustomInput(false);
    await setModel.mutateAsync({ model: null });
  }, [setModel]);

  const openCustomInput = useCallback(() => {
    // Pre-fill the input with whatever is currently saved as free text,
    // or empty if the saved value was a preset / null.
    setCustomDraft(current && !presets.includes(current) ? current : "");
    setShowCustomInput(true);
  }, [current, presets]);

  const commitCustom = useCallback(async () => {
    const trimmed = customDraft.trim();
    if (trimmed.length === 0) return;
    await setModel.mutateAsync({ model: trimmed });
    setShowCustomInput(false);
  }, [customDraft, setModel]);

  return (
    <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Model
      </div>
      {isLoading ? (
        <div className="text-xs text-stone-500 dark:text-stone-400">Loading…</div>
      ) : (
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name={`model-${provider}`}
              value={DEFAULT_VALUE}
              checked={radio === DEFAULT_VALUE}
              onChange={() => void selectDeploymentDefault()}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-stone-900 dark:text-stone-100">
                Use deployment default
              </span>
              <span className="ml-2 text-xs text-stone-500 dark:text-stone-400">
                (env / built-in)
              </span>
            </span>
          </label>

          {presets.map((preset) => (
            <label
              key={preset}
              className="flex items-start gap-2 text-sm cursor-pointer"
            >
              <input
                type="radio"
                name={`model-${provider}`}
                value={preset}
                checked={radio === preset}
                onChange={() => void selectPreset(preset)}
                className="mt-0.5"
              />
              <span className="font-mono text-stone-900 dark:text-stone-100">
                {preset}
              </span>
            </label>
          ))}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`model-${provider}`}
              value={CUSTOM_VALUE}
              checked={radio === CUSTOM_VALUE}
              onChange={() => openCustomInput()}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="font-medium text-stone-900 dark:text-stone-100">
                Custom…
              </span>
              {showCustomInput ? (
                <span className="mt-1.5 flex gap-2">
                  <input
                    type="text"
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    placeholder="e.g. gpt-4o-mini"
                    maxLength={200}
                    className="flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-mono text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitCustom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void commitCustom()}
                    disabled={!customDraft.trim() || setModel.isPending}
                    className="rounded-md bg-stone-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                  >
                    Save
                  </button>
                </span>
              ) : null}
            </span>
          </label>
          {setModel.isPending ? (
            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">Saving…</div>
          ) : null}
          {!showCustomInput && current && !isPresetMatch ? (
            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Currently saved: <span className="font-mono">{current}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
