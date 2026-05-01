import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
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

// ─────────────────────────────────────────────────────────────────────────
// Per-user provider-preference + chat-model cache (spec §3.3 / §3.4).
//
// Both pieces of user state live on the `users` row. We cache them together
// keyed by userId — single DB hit per warm cache window covers both
// `getProviderMode({ userId })` and `resolveAiSdkModelId("chat", mode, ...)`.
//
// TTL is 30s (short enough that the next request after a Settings save
// reflects the change even on cache miss), and any explicit save MUST call
// `invalidateProviderPrefCache(userId)` so the change is observed instantly.
// ─────────────────────────────────────────────────────────────────────────

const PROVIDER_PREF_CACHE_TTL_MS = 30_000;
const MAX_CACHE = 1000;

type AiProviderPreference =
  | "knosi-hosted"
  | "claude-code-daemon"
  | "openai"
  | "local"
  | "cursor"
  | null;

type UserAiPrefRow = {
  pref: AiProviderPreference;
  chatModel: string | null;
};

type CacheEntry = {
  value: UserAiPrefRow;
  expires: number;
};

const userAiPrefCache = new Map<string, CacheEntry>();

async function loadUserAiPref(userId: string): Promise<UserAiPrefRow> {
  // Lazy-imported to avoid a cycle: db schema imports drizzle, and drizzle's
  // sqlite driver init must not run at the top of every provider module.
  const { db } = await import("@/server/db");
  const { users } = await import("@/server/db/schema/auth");
  try {
    const [row] = await db
      .select({
        pref: users.aiProviderPreference,
        chatModel: users.aiChatModel,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      pref: (row?.pref ?? null) as AiProviderPreference,
      chatModel: row?.chatModel ?? null,
    };
  } catch {
    // DB blip should never break Ask AI — fall back to env-only resolution.
    return { pref: null, chatModel: null };
  }
}

async function getCachedUserAiPref(userId: string): Promise<UserAiPrefRow> {
  const now = Date.now();
  const cached = userAiPrefCache.get(userId);
  if (cached && cached.expires > now) {
    return cached.value;
  }
  const value = await loadUserAiPref(userId);
  if (userAiPrefCache.size >= MAX_CACHE) {
    // Evict the oldest entry (LRU-ish — Map preserves insertion order).
    const oldest = userAiPrefCache.keys().next().value;
    if (oldest) userAiPrefCache.delete(oldest);
  }
  userAiPrefCache.set(userId, {
    value,
    expires: now + PROVIDER_PREF_CACHE_TTL_MS,
  });
  return value;
}

/**
 * Drop the cached per-user provider/chat-model entry. Call this from any
 * mutation that updates `users.aiProviderPreference` / `users.aiChatModel`
 * so the very next `getProviderMode` / `resolveAiSdkModelId` reflects the
 * new value without waiting for the 30s TTL.
 */
export function invalidateProviderPrefCache(userId: string): void {
  userAiPrefCache.delete(userId);
}

/**
 * Internal accessor used by `resolveAiSdkModelId` (sibling module) so it
 * can share the same single-row read with `getProviderMode`. Not exported
 * to consumers — they should go through the model resolver.
 */
export async function getCachedUserChatModel(
  userId: string,
): Promise<string | null> {
  const { chatModel } = await getCachedUserAiPref(userId);
  return chatModel;
}

type ProviderModeContext = { userId?: string | null };

/**
 * Resolve the active AI provider mode.
 *
 * Resolution order (spec §3.3):
 *   1. user preference on `users.aiProviderPreference` (cached 30s)
 *   2. explicit `AI_PROVIDER` env var
 *   3. auto-detect (codex auth profile → openai → local)
 *
 * Becoming async is intentional — without a DB round-trip we cannot honor
 * a per-user setting. Identity-prompt code that has no userId context can
 * still call the sync `getProviderModeSync()` to skip the user-pref branch.
 */
export async function getProviderMode(
  ctx: ProviderModeContext = {},
): Promise<AIProviderMode> {
  if (ctx.userId) {
    const { pref } = await getCachedUserAiPref(ctx.userId);
    if (pref) {
      // The "knosi-hosted" preference is a routing intent — the underlying
      // backend is the codex pool. Map to "codex" so downstream provider
      // dispatchers don't need to know about this UI-layer label.
      // `claude-code-daemon` is intentionally honored here even though
      // `shouldUseDaemonForChat()` (the daemon branch in route.ts) still
      // gates on env — when daemon isn't actually set up, the existing
      // banner / error UX informs the user.
      if (pref === "knosi-hosted") return "codex";
      return pref as AIProviderMode;
    }
  }
  return getProviderModeSync();
}

/**
 * Sync provider-mode resolution that ignores user preference. Used by
 * `identity.ts` (system-prompt assembly) to avoid bubbling async up the
 * chain — see spec §3.6 step 3 / §3.7.
 */
export function getProviderModeSync(): AIProviderMode {
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
  if (explicitMode === "cursor") {
    return "cursor";
  }

  if (hasCodexAuthProfile()) {
    return "codex";
  }

  if (resolveValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }

  return "local";
}

// Test-only helper — not exported through any barrel — to flush cache
// between unit-test cases without leaning on the 30s TTL.
export function __resetProviderPrefCacheForTests(): void {
  userAiPrefCache.clear();
}
