/**
 * Provider façade — picks the right backend at runtime (local / openai /
 * codex / claude-code-daemon) and forwards chat or structured-data calls
 * to the matching file under `./`.
 *
 * Adding a new provider = one new file here plus a branch in the two
 * dispatchers below. Identity/setup helpers live in `identity.ts`.
 *
 * Hosted-mode Pro users: when `KNOSI_HOSTED_MODE=true`, a `userId` is
 * threaded through, and the caller's entitlements grant `knosiProvidedAi`,
 * the facade routes through `runWithHostedAi` — which picks an account
 * from the Codex pool and falls back on 429/403. Free users (and
 * self-hosted users) continue through the env-selected provider, which
 * is typically their own BYO credential.
 */

import { eq } from "drizzle-orm";
import type { z } from "zod/v4";
import { getEntitlements } from "@/server/billing/entitlements";
import { isHostedMode } from "@/server/billing/mode";
import { runWithHostedAi } from "@/server/billing/ai-providers/hosted";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
import { generateStructuredDataAiSdk, streamChatAiSdk } from "./ai-sdk";
import { generateStructuredDataCodex, streamChatCodex } from "./codex";
import { generateStructuredDataDaemon } from "./daemon";
import { getProviderMode } from "./mode";
import type {
  GenerateStructuredDataOptions,
  StreamChatOptions,
} from "./types";

type UserContext = { userId?: string | null };

type AiProviderPreference =
  | "knosi-hosted"
  | "claude-code-daemon"
  | "openai"
  | "local"
  | null;

async function getUserProviderPreference(
  userId: string,
): Promise<AiProviderPreference> {
  const [row] = await db
    .select({ pref: users.aiProviderPreference })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row?.pref ?? null) as AiProviderPreference;
}

/**
 * Decide whether to route through the Knosi-hosted Codex pool.
 *
 * - Requires hosted mode + an authenticated userId + the `knosiProvidedAi`
 *   entitlement (i.e. Pro plan).
 * - Honors the user's explicit preference: if they picked a BYO option
 *   (claude-code-daemon / openai / local), we do NOT route through hosted
 *   even if they are otherwise eligible. A `null` preference means
 *   "default", which for Pro users resolves to hosted.
 *
 * Note: BYO preferences (daemon/openai/local) only control the decision to
 * bypass the hosted pool. Per-user selection of which BYO backend to use is
 * deferred — today the actual backend is still chosen by `AI_PROVIDER`.
 */
async function shouldRouteHosted(userId: string | null | undefined): Promise<boolean> {
  if (!isHostedMode()) return false;
  if (!userId) return false;
  const ent = await getEntitlements(userId);
  if (!ent.features.knosiProvidedAi) return false;
  const pref = await getUserProviderPreference(userId);
  if (pref === null || pref === "knosi-hosted") return true;
  return false;
}

export type StreamChatResult = {
  response: Response;
  /** Resolved model id, or null when the path doesn't expose one (codex / daemon). Spec §6.2. */
  modelId: string | null;
};

export async function streamChatResponse(
  options: StreamChatOptions,
  user: UserContext = {},
): Promise<StreamChatResult> {
  const mode = await getProviderMode({ userId: user.userId });

  if (mode === "claude-code-daemon") {
    throw new Error(
      "streamChatResponse must not be called when AI_PROVIDER=claude-code-daemon. " +
        "The chat route should have taken the daemon enqueue branch."
    );
  }

  // Tool-calling is only wired up for the AI SDK path (openai + local).
  // Codex / hosted-pool / daemon currently run single-turn — silently
  // drop the `tools` / `maxSteps` fields so the legacy adapters don't
  // need to know about them. Spec §5.3.
  const optionsWithoutTools: StreamChatOptions = {
    messages: options.messages,
    sessionId: options.sessionId,
    signal: options.signal,
    system: options.system,
  };

  if (user.userId && (await shouldRouteHosted(user.userId))) {
    const result = await runWithHostedAi(user.userId, (authPath) =>
      streamChatCodex(optionsWithoutTools, { authStorePath: authPath }),
    );
    if (!result.ok) {
      throw new Error(
        result.error === "NO_POOL"
          ? "Knosi hosted AI is not configured (KNOSI_CODEX_ACCOUNT_POOL empty)."
          : "All Knosi hosted AI accounts are currently unavailable. Please try again shortly.",
      );
    }
    return { response: result.value, modelId: null };
  }

  if (mode === "codex") {
    return { response: await streamChatCodex(optionsWithoutTools), modelId: null };
  }

  const sdkResult = await streamChatAiSdk(
    { ...options, mode },
    { userId: user.userId },
  );
  return { response: sdkResult.response, modelId: sdkResult.modelId };
}

export async function generateStructuredData<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema>,
  user: UserContext = {},
): Promise<z.infer<TSchema>> {
  const mode = await getProviderMode({ userId: user.userId });

  if (mode === "claude-code-daemon") {
    return generateStructuredDataDaemon(options);
  }

  if (user.userId && (await shouldRouteHosted(user.userId))) {
    const result = await runWithHostedAi(user.userId, (authPath) =>
      generateStructuredDataCodex(options, { authStorePath: authPath }),
    );
    if (!result.ok) {
      throw new Error(
        result.error === "NO_POOL"
          ? "Knosi hosted AI is not configured (KNOSI_CODEX_ACCOUNT_POOL empty)."
          : "All Knosi hosted AI accounts are currently unavailable. Please try again shortly.",
      );
    }
    return result.value;
  }

  if (mode === "codex") {
    return generateStructuredDataCodex(options);
  }

  return generateStructuredDataAiSdk({ ...options, mode }, { userId: user.userId });
}

export {
  getAIErrorMessage,
  getAISetupHint,
  getChatAssistantIdentity,
} from "./identity";

export { streamPlainTextAiSdk } from "./ai-sdk";
export type { AiSdkMode } from "./ai-sdk";
