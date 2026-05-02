/**
 * Provider façade — resolves the user's role assignment and dispatches
 * to the matching backend implementation.
 *
 * All callers must supply { userId, role }. Self-hosted / E2E bypass with
 * no userId is no longer supported by this entry point — callers that
 * historically relied on env-only resolution must seed
 * `ai_providers` + `ai_role_assignments` rows for the test user.
 */

import type { z } from "zod/v4";
import { resolveAiCall } from "./resolve";
import {
  generateStructuredDataAiSdk,
  streamChatAiSdk,
  streamPlainTextAiSdk as streamPlainTextAiSdkInner,
} from "./ai-sdk";
import { generateStructuredDataDaemon } from "./daemon";
import type {
  AiRole,
  GenerateStructuredDataOptions,
  StreamChatOptions,
} from "./types";

export type StreamChatResult = {
  response: Response;
  modelId: string | null;
  /** ProviderKind that actually handled the request (for X-Knosi-Kind header). */
  kind: string;
};

export async function streamChatResponse(
  options: StreamChatOptions,
  ctx: { userId: string; role?: Exclude<AiRole, "embedding"> },
): Promise<StreamChatResult> {
  const role: AiRole = ctx.role ?? "chat";
  const provider = await resolveAiCall(role, ctx.userId);

  if (provider.kind === "claude-code-daemon") {
    throw new Error(
      "streamChatResponse must not be called when the chat role is assigned to claude-code-daemon. " +
        "The /api/chat handler is responsible for taking the daemon enqueue branch.",
    );
  }
  if (provider.kind === "transformers") {
    throw new Error("transformers kind cannot serve chat/task — only embedding.");
  }

  const result = await streamChatAiSdk({ ...options, provider });
  return {
    response: result.response,
    modelId: result.modelId,
    kind: provider.kind,
  };
}

export async function generateStructuredData<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema>,
  ctx: { userId: string; role?: Exclude<AiRole, "embedding"> },
): Promise<z.infer<TSchema>> {
  const role: AiRole = ctx.role ?? "task";
  const provider = await resolveAiCall(role, ctx.userId);

  if (provider.kind === "claude-code-daemon") {
    return generateStructuredDataDaemon({
      ...options,
      modelId: provider.modelId,
      userId: ctx.userId,
    });
  }
  if (provider.kind === "transformers") {
    throw new Error("transformers kind cannot serve task — only embedding.");
  }
  return generateStructuredDataAiSdk({ ...options, provider });
}

export async function streamPlainTextAiSdk(options: {
  system: string;
  messages: import("ai").ModelMessage[];
  signal?: AbortSignal;
  userId: string;
  role?: Exclude<AiRole, "embedding">;
}) {
  const role: AiRole = options.role ?? "chat";
  const provider = await resolveAiCall(role, options.userId);
  if (provider.kind === "claude-code-daemon" || provider.kind === "transformers") {
    throw new Error(
      `streamPlainTextAiSdk does not support kind=${provider.kind}; assignment must be openai-compatible or local.`,
    );
  }
  return streamPlainTextAiSdkInner({
    system: options.system,
    messages: options.messages,
    signal: options.signal,
    provider,
  });
}

export type { ResolvedProvider, AiRole, ProviderKind } from "./types";
export { MissingAiRoleError } from "./types";
export { invalidateProviderCache } from "./resolve";

export {
  getAIErrorMessage,
  getAISetupHint,
  getChatAssistantIdentity,
} from "./identity";
