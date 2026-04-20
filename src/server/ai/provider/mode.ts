import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonFile, resolveValue } from "./shared";
import type { AIProviderMode, CodexAuthStore } from "./types";

export const DEFAULT_CODEX_PROVIDER = "openai-codex";
export const DEFAULT_CODEX_PROFILE_ID = "openai-codex:default";

const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_CODEX_AUTH_STORE_PATH = join(
  homedir(),
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);

export function readOpenclawConfig() {
  return readJsonFile<{
    agents?: { defaults?: { model?: { primary?: string } } };
    auth?: { order?: Record<string, string[]> };
  }>(resolveValue(process.env.OPENCLAW_CONFIG_PATH) ?? DEFAULT_OPENCLAW_CONFIG_PATH);
}

export function resolveCodexProfileId() {
  const configuredProfileId = resolveValue(
    process.env.CODEX_AUTH_PROFILE_ID,
    process.env.OPENCLAW_CODEX_PROFILE_ID
  );
  if (configuredProfileId) {
    return configuredProfileId;
  }

  const openclawConfig = readOpenclawConfig();
  const orderedProfiles = openclawConfig?.auth?.order?.[DEFAULT_CODEX_PROVIDER];
  return orderedProfiles?.[0] ?? DEFAULT_CODEX_PROFILE_ID;
}

export function resolveCodexAuthStorePath(override?: string) {
  return (
    resolveValue(
      override,
      process.env.CODEX_AUTH_STORE_PATH,
      process.env.OPENCLAW_CODEX_AUTH_STORE_PATH
    ) ?? DEFAULT_CODEX_AUTH_STORE_PATH
  );
}

/**
 * Expand a leading `~/` / bare `~` to the user's home directory, and, if the
 * override points at a directory (no `.json` suffix), append the canonical
 * codex store filename. Used by hosted-pool callers that hand us a per-account
 * base dir like `~/.openclaw/<account>`.
 */
export function normalizeCodexAuthStorePath(raw: string): string {
  let expanded = raw;
  if (expanded === "~") {
    expanded = homedir();
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = join(homedir(), expanded.slice(2));
  }
  if (!expanded.toLowerCase().endsWith(".json")) {
    expanded = join(expanded, "agents", "main", "agent", "auth-profiles.json");
  }
  return expanded;
}

export function readCodexAuthStore(override?: string) {
  const storePath = resolveCodexAuthStorePath(override);
  const authStore = readJsonFile<CodexAuthStore>(storePath);

  if (!authStore) {
    return null;
  }

  return { authStore, storePath };
}

function hasCodexAuthProfile() {
  const store = readCodexAuthStore();
  if (!store?.authStore.profiles) {
    return false;
  }

  return Boolean(store.authStore.profiles[resolveCodexProfileId()]);
}

export function getProviderMode(): AIProviderMode {
  const explicitMode = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicitMode === "claude-code-daemon") {
    return "claude-code-daemon";
  }
  if (explicitMode === "codex" || explicitMode === "openai-codex") {
    return "codex";
  }
  if (explicitMode === "openai") {
    return "openai";
  }
  if (explicitMode === "local") {
    return "local";
  }

  if (hasCodexAuthProfile()) {
    return "codex";
  }

  if (resolveValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }

  return "local";
}
