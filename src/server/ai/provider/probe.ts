import type { ProviderKind } from "./types";

export type ProbeInput =
  | { kind: "openai-compatible"; baseURL: string; apiKey: string }
  | { kind: "local"; baseURL: string }
  | { kind: "claude-code-daemon" }
  | { kind: "transformers" };

export type ProbeResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

const PROBE_TIMEOUT_MS = 8000;

function trimBase(url: string) {
  return url.replace(/\/+$/, "");
}

async function probeOpenAiCompat(
  baseURL: string,
  apiKey: string | null,
): Promise<ProbeResult> {
  const url = `${trimBase(baseURL)}/models`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message ?? j?.message ?? msg;
      } catch {}
      return { ok: false, error: msg };
    }
    let models: string[] = [];
    try {
      const j = JSON.parse(text);
      models = (j?.data ?? [])
        .map((m: { id?: string }) => m?.id)
        .filter((x: unknown): x is string => typeof x === "string");
    } catch {}
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeProvider(input: ProbeInput): Promise<ProbeResult> {
  if (input.kind === "openai-compatible") {
    return probeOpenAiCompat(input.baseURL, input.apiKey);
  }
  if (input.kind === "local") {
    return probeOpenAiCompat(input.baseURL, null);
  }
  if (input.kind === "claude-code-daemon") {
    // Daemon health: defer to existing infra via /api/daemon/status if needed.
    // For provider-test purposes we accept the assignment as live; the actual
    // health surfaces in the dedicated daemon banner.
    return { ok: true, models: ["opus", "sonnet"] };
  }
  // transformers: in-process; if module loads, it's ok.
  try {
    await import("@huggingface/transformers");
    return { ok: true, models: ["Xenova/multilingual-e5-small"] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type { ProviderKind };
