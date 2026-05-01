"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ModelPicker } from "./model-picker";

type ProviderOption = {
  value:
    | "knosi-hosted"
    | "claude-code-daemon"
    | "openai"
    | "local"
    | "cursor";
  label: string;
  desc: string;
  proOnly?: boolean;
};

const OPTIONS: readonly ProviderOption[] = [
  {
    value: "knosi-hosted",
    label: "Knosi AI",
    desc: "No setup, works on all devices",
    proOnly: true,
  },
  {
    value: "claude-code-daemon",
    label: "Claude Code Daemon",
    desc: "Your own Claude Pro/Max subscription",
  },
  {
    value: "openai",
    label: "OpenAI API",
    desc: "Your own key",
  },
  {
    value: "local",
    label: "Local (Ollama / LM Studio)",
    desc: "For self-hosters",
  },
  {
    value: "cursor",
    label: "Cursor (Proxy)",
    desc: "Reuse your Cursor subscription via knosi.xyz/cursor proxy",
  },
] as const;

type OptionValue = ProviderOption["value"];

export function AiProviderSection() {
  const { data: ent } = trpc.billing.me.useQuery();
  const setPref = trpc.billing.setAiProviderPreference.useMutation();
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<OptionValue>("knosi-hosted");

  if (!ent) return null;
  const isPro = ent.features.knosiProvidedAi;

  async function select(value: OptionValue) {
    setSaving(value);
    try {
      await setPref.mutateAsync({ preference: value });
      setSelected(value);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          AI Provider
        </h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Choose which AI backend powers Ask AI and other AI features.
        </p>
      </div>
      <div className="space-y-2">
        {OPTIONS.map((opt) => {
          const disabled = opt.proOnly && !isPro;
          const radioId = `ai-provider-${opt.value}`;
          return (
            <div
              key={opt.value}
              className={`rounded-2xl border border-stone-200 p-3 dark:border-stone-800 ${
                disabled ? "opacity-50" : ""
              }`}
            >
              <label
                htmlFor={radioId}
                className={`flex items-start gap-3 ${
                  disabled
                    ? ""
                    : "cursor-pointer"
                }`}
              >
                <input
                  id={radioId}
                  type="radio"
                  name="ai-provider"
                  value={opt.value}
                  disabled={disabled}
                  checked={selected === opt.value}
                  onChange={() => {
                    if (!disabled) void select(opt.value);
                  }}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {opt.label}
                    {opt.proOnly ? (
                      <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
                        Pro
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    {opt.desc}
                  </div>
                  {saving === opt.value ? (
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Saving…
                    </div>
                  ) : null}
                </div>
              </label>
              {selected === opt.value && !disabled ? (
                <ModelPicker provider={opt.value} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
