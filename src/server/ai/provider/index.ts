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

import type { z } from "zod/v4";
import { getEntitlements } from "@/server/billing/entitlements";
import { isHostedMode } from "@/server/billing/mode";
import { runWithHostedAi } from "@/server/billing/ai-providers/hosted";
import { generateStructuredDataAiSdk, streamChatAiSdk } from "./ai-sdk";
import { generateStructuredDataCodex, streamChatCodex } from "./codex";
import { generateStructuredDataDaemon } from "./daemon";
import { getProviderMode } from "./mode";
import type {
  GenerateStructuredDataOptions,
  StreamChatOptions,
} from "./types";

type UserContext = { userId?: string | null };

async function shouldRouteHosted(userId: string | null | undefined): Promise<boolean> {
  if (!isHostedMode()) return false;
  if (!userId) return false;
  const ent = await getEntitlements(userId);
  return ent.features.knosiProvidedAi === true;
}

export async function streamChatResponse(
  options: StreamChatOptions,
  user: UserContext = {},
) {
  const mode = getProviderMode();

  if (mode === "claude-code-daemon") {
    throw new Error(
      "streamChatResponse must not be called when AI_PROVIDER=claude-code-daemon. " +
        "The chat route should have taken the daemon enqueue branch."
    );
  }

  if (user.userId && (await shouldRouteHosted(user.userId))) {
    const result = await runWithHostedAi(user.userId, (authPath) =>
      streamChatCodex(options, { authStorePath: authPath }),
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
    return streamChatCodex(options);
  }

  return streamChatAiSdk({ ...options, mode });
}

export async function generateStructuredData<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema>,
  user: UserContext = {},
): Promise<z.infer<TSchema>> {
  const mode = getProviderMode();

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

  return generateStructuredDataAiSdk({ ...options, mode });
}

export {
  getAIErrorMessage,
  getAISetupHint,
  getChatAssistantIdentity,
} from "./identity";
