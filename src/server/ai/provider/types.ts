import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod/v4";

export type ProviderKind =
  | "openai-compatible"
  | "local"
  | "claude-code-daemon"
  | "transformers";

export type AiRole = "chat" | "task" | "embedding";

export type ResolvedProvider =
  | {
      kind: "openai-compatible";
      providerId: string;
      label: string;
      baseURL: string;
      apiKey: string;
      modelId: string;
    }
  | {
      kind: "local";
      providerId: string;
      label: string;
      baseURL: string;
      modelId: string;
    }
  | {
      kind: "claude-code-daemon";
      providerId: string;
      label: string;
      modelId: string;
    }
  | {
      kind: "transformers";
      providerId: string;
      label: string;
      modelId: string;
    };

export class MissingAiRoleError extends Error {
  constructor(public readonly role: AiRole) {
    super(
      `No provider assigned to AI role "${role}". Configure one in Settings.`,
    );
    this.name = "MissingAiRoleError";
  }
}

export type StreamChatOptions = {
  messages: ModelMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  system: string;
  /**
   * Tools are honored only by `openai-compatible` and `local` providers.
   * `claude-code-daemon` and `transformers` ignore them (single-turn / N/A).
   */
  tools?: ToolSet;
  /**
   * Maximum number of LLM steps (model call + tool resolutions). Honored
   * alongside `tools`. Defaulted by `maxStepsForKind()` below when omitted.
   */
  maxSteps?: number;
};

export type GenerateStructuredDataOptions<TSchema extends z.ZodType> = {
  description: string;
  name: string;
  prompt: string;
  schema: TSchema;
  signal?: AbortSignal;
};

/**
 * Default tool-loop step cap by provider kind.
 *
 *   openai-compatible: 6 — gpt-class / Claude can plan a few searches
 *   local:             3 — qwen2.5 / smaller models loop, cut early
 *   claude-code-daemon: 1 — single-turn, no tool support
 *   transformers:      1 — embedding only, no tool support
 */
export function maxStepsForKind(kind: ProviderKind): number {
  if (kind === "openai-compatible") return 6;
  if (kind === "local") return 3;
  return 1;
}
