import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod/v4";

export type AIProviderMode = "local" | "openai" | "codex" | "claude-code-daemon";

export type GenerationKind = "chat" | "task";

export type StreamChatOptions = {
  messages: ModelMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  system: string;
  /**
   * Optional tool set that the model may call mid-stream. Honored only by
   * providers that support multi-step tool calling (currently the Vercel AI
   * SDK path: openai + local). Codex / claude-code-daemon ignore this field
   * and continue running single-turn — see `provider/index.ts`.
   */
  tools?: ToolSet;
  /**
   * Maximum number of LLM steps in a single response. A "step" is one
   * model call + any tool resolutions; the loop stops once the model
   * stops emitting tool calls or this cap is hit. Honored alongside `tools`.
   */
  maxSteps?: number;
};

/**
 * Per-mode default for `maxSteps`. Spec §5.1.
 *
 * - openai: 6 — gpt-class models can plan over a few searches without
 *   looping; we want enough headroom for "compare X vs Y" patterns
 * - local: 3 — qwen2.5 / smaller models tend to loop; cut early
 * - codex / claude-code-daemon: 1 — those run single-turn, no tool support
 */
export function maxStepsByMode(mode: AIProviderMode): number {
  if (mode === "openai") return 6;
  if (mode === "local") return 3;
  return 1;
}

export type GenerateStructuredDataOptions<TSchema extends z.ZodType> = {
  description: string;
  name: string;
  prompt: string;
  schema: TSchema;
  signal?: AbortSignal;
};

export type CodexProfile = {
  access: string;
  accountId?: string;
  expires: number;
  provider?: string;
  refresh: string;
  type?: string;
  [key: string]: unknown;
};

export type CodexAuthStore = {
  order?: Record<string, string[]>;
  profiles?: Record<string, CodexProfile>;
  usageStats?: Record<string, unknown>;
  version?: unknown;
  [key: string]: unknown;
};

export type CodexSseEvent = {
  delta?: string;
  item?: {
    content?: Array<{ text?: string; type?: string }>;
    error?: { message?: string };
    type?: string;
  };
  message?: string;
  response?: {
    error?: { message?: string };
    status?: string;
  };
  type?: string;
};
