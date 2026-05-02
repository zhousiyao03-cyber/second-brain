import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiProviders, aiRoleAssignments } from "@/server/db/schema/ai-providers";
import { decryptApiKey } from "@/server/ai/crypto";
import { MissingAiRoleError } from "./types";
import type { AiRole, ResolvedProvider } from "./types";

const TTL_MS = 30_000;
const MAX_CACHE = 1000;

type CacheEntry = {
  expires: number;
  byRole: Partial<Record<AiRole, ResolvedProvider>>;
};

const cache = new Map<string, CacheEntry>();

export function invalidateProviderCache(userId: string): void {
  cache.delete(userId);
}

export function __resetProviderCacheForTests(): void {
  cache.clear();
}

async function loadResolved(
  userId: string,
  role: AiRole,
): Promise<ResolvedProvider> {
  const [row] = await db
    .select({
      providerId: aiProviders.id,
      kind: aiProviders.kind,
      label: aiProviders.label,
      baseUrl: aiProviders.baseUrl,
      apiKeyEnc: aiProviders.apiKeyEnc,
      modelId: aiRoleAssignments.modelId,
    })
    .from(aiRoleAssignments)
    .innerJoin(aiProviders, eq(aiProviders.id, aiRoleAssignments.providerId))
    .where(
      and(
        eq(aiRoleAssignments.userId, userId),
        eq(aiRoleAssignments.role, role),
      ),
    )
    .limit(1);

  if (!row) throw new MissingAiRoleError(role);

  if (role === "embedding" && row.kind === "claude-code-daemon") {
    throw new Error(
      "Role 'embedding' cannot be served by a 'claude-code-daemon' provider. Reassign embedding to an openai-compatible / local / transformers provider.",
    );
  }

  if (row.kind === "openai-compatible") {
    if (!row.baseUrl || !row.apiKeyEnc) {
      throw new Error(
        `Provider ${row.providerId} (kind=openai-compatible) is missing base_url or api_key_enc.`,
      );
    }
    return {
      kind: "openai-compatible",
      providerId: row.providerId,
      label: row.label,
      baseURL: row.baseUrl,
      apiKey: decryptApiKey(row.apiKeyEnc),
      modelId: row.modelId,
    };
  }
  if (row.kind === "local") {
    if (!row.baseUrl) {
      throw new Error(
        `Provider ${row.providerId} (kind=local) is missing base_url.`,
      );
    }
    return {
      kind: "local",
      providerId: row.providerId,
      label: row.label,
      baseURL: row.baseUrl,
      modelId: row.modelId,
    };
  }
  if (row.kind === "claude-code-daemon") {
    return {
      kind: "claude-code-daemon",
      providerId: row.providerId,
      label: row.label,
      modelId: row.modelId,
    };
  }
  // transformers
  return {
    kind: "transformers",
    providerId: row.providerId,
    label: row.label,
    modelId: row.modelId,
  };
}

export async function resolveAiCall(
  role: AiRole,
  userId: string,
): Promise<ResolvedProvider> {
  const now = Date.now();
  const entry = cache.get(userId);
  if (entry && entry.expires > now && entry.byRole[role]) {
    return entry.byRole[role]!;
  }

  const resolved = await loadResolved(userId, role);

  if (cache.size >= MAX_CACHE && !entry) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const next: CacheEntry =
    entry && entry.expires > now
      ? entry
      : { expires: now + TTL_MS, byRole: {} };
  next.byRole[role] = resolved;
  cache.set(userId, next);
  return resolved;
}
