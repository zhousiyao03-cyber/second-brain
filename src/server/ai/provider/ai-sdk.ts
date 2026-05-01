import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type { z } from "zod/v4";
import { getCachedUserChatModel } from "./mode";
import { resolveValue } from "./shared";
import type {
  AIProviderMode,
  GenerateStructuredDataOptions,
  GenerationKind,
  StreamChatOptions,
} from "./types";

type AiSdkContext = { userId?: string | null };

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_CHAT_MODEL = "qwen2.5:14b";
const DEFAULT_LOCAL_TASK_MODEL = "qwen2.5:14b";
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TASK_MODEL = "gpt-5.4";

export type AiSdkMode = Exclude<AIProviderMode, "codex" | "claude-code-daemon">;

/**
 * Vercel AI SDK's experimental_telemetry defaults `recordInputs` and
 * `recordOutputs` to true — meaning when Langfuse is wired up the full prompt
 * (including RAG-injected note bodies) and full LLM completion are exported as
 * span attributes to cloud.langfuse.com.
 *
 * Privacy-by-default: only record content when the operator explicitly opts in
 * via LANGFUSE_RECORD_CONTENT=true. Trace structure / latencies still flow.
 */
function shouldRecordTelemetryContent() {
  return process.env.LANGFUSE_RECORD_CONTENT === "true";
}

function createAiSdkProvider(mode: AiSdkMode) {
  if (mode === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error(
        "Missing OPENAI_API_KEY. Add it to .env.local or switch AI_PROVIDER to codex/local."
      );
    }

    return createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: resolveValue(process.env.OPENAI_BASE_URL),
      organization: resolveValue(process.env.OPENAI_ORGANIZATION),
      project: resolveValue(process.env.OPENAI_PROJECT),
    });
  }

  return createOpenAI({
    name: "local-ai",
    baseURL:
      resolveValue(process.env.AI_BASE_URL, process.env.LOCAL_AI_BASE_URL) ??
      DEFAULT_LOCAL_BASE_URL,
    apiKey:
      resolveValue(process.env.AI_API_KEY, process.env.LOCAL_AI_API_KEY) ??
      "local",
  });
}

/**
 * Sync env / built-in resolution shared by both the user-aware path and
 * the identity-prompt path. Does NOT read per-user preference.
 */
export function resolveAiSdkModelIdSync(
  kind: GenerationKind,
  mode: AiSdkMode,
): string {
  if (mode === "openai") {
    const fallbackModelId =
      kind === "chat" ? DEFAULT_OPENAI_CHAT_MODEL : DEFAULT_OPENAI_TASK_MODEL;

    return (
      resolveValue(
        kind === "chat"
          ? process.env.OPENAI_CHAT_MODEL
          : process.env.OPENAI_TASK_MODEL,
        process.env.OPENAI_MODEL
      ) ?? fallbackModelId
    );
  }

  const fallbackModelId =
    kind === "chat" ? DEFAULT_LOCAL_CHAT_MODEL : DEFAULT_LOCAL_TASK_MODEL;

  return (
    resolveValue(
      kind === "chat" ? process.env.AI_CHAT_MODEL : process.env.AI_TASK_MODEL,
      kind === "chat"
        ? process.env.LOCAL_AI_CHAT_MODEL
        : process.env.LOCAL_AI_TASK_MODEL,
      process.env.AI_MODEL,
      process.env.LOCAL_AI_MODEL
    ) ?? fallbackModelId
  );
}

/**
 * Resolve the chat / task model id for the AI-SDK path.
 *
 * Precedence (spec §3.4):
 *   1. user preference on `users.aiChatModel` — `kind === "chat"` only
 *   2. provider-specific env var (OPENAI_CHAT_MODEL / AI_CHAT_MODEL / ...)
 *   3. built-in default
 *
 * `kind === "task"` deliberately ignores user preference: structured-data
 * generation is sensitive to schema-parsing reliability, so we always run
 * it on the deployment-default model. Spec §3.4.
 */
export async function resolveAiSdkModelId(
  kind: GenerationKind,
  mode: AiSdkMode,
  ctx: AiSdkContext = {},
): Promise<string> {
  if (kind === "chat" && ctx.userId) {
    const userModel = await getCachedUserChatModel(ctx.userId);
    if (userModel?.trim()) {
      return userModel.trim();
    }
  }
  return resolveAiSdkModelIdSync(kind, mode);
}

export type StreamChatAiSdkResult = {
  /** Underlying UI-message-stream Response from `toUIMessageStreamResponse()`. */
  response: Response;
  /** Resolved model id actually passed to the LLM provider. Spec §6.2 / §6.3. */
  modelId: string;
};

export async function streamChatAiSdk(
  {
    messages,
    signal,
    system,
    mode,
    tools,
    maxSteps,
  }: StreamChatOptions & { mode: AiSdkMode },
  ctx: AiSdkContext = {},
): Promise<StreamChatAiSdkResult> {
  const provider = createAiSdkProvider(mode);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);
  const modelId = await resolveAiSdkModelId("chat", mode, ctx);

  const result = streamText({
    abortSignal: signal,
    model: provider(modelId),
    messages,
    system,
    // Tools are only meaningful with `stopWhen` — without it the SDK
    // defaults to stepCountIs(1) and the loop never proceeds past the
    // first tool_call. We only attach the tool set when caller explicitly
    // opted in; otherwise streamText keeps its old behavior.
    ...(hasTools
      ? {
          tools,
          stopWhen: stepCountIs(maxSteps ?? 1),
        }
      : {}),
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      // Different functionId for the tool-loop path so we can compare
      // step counts / latency / cost against the legacy single-turn path
      // in Langfuse without dilution. Spec §5.6.
      functionId: hasTools ? "ask-ai-agent" : "chat",
      metadata: {
        mode,
        // Spec §6.3 — surface the resolved model id so we can chart model
        // distribution in Langfuse (per-user model selection means this
        // can now vary across requests).
        model: modelId,
        ...(hasTools ? { hasTools: true, maxSteps: maxSteps ?? 1 } : {}),
      },
    },
  });

  // The UI message stream protocol carries tool-call / tool-result parts
  // that the front-end's <ChatMessageParts> component needs to render
  // step badges. Single-turn callers don't get tool parts so the
  // payload is functionally equivalent to a text stream.
  return { response: result.toUIMessageStreamResponse(), modelId };
}

/**
 * Plain-text streaming for internal callers that want an AsyncIterable<string>
 * (not an HTTP Response). Used by the council module's per-persona streaming.
 *
 * Limitation: this path goes through the AI SDK directly, so it ignores
 * `claude-code-daemon` / `codex` modes — caller is responsible for falling
 * back if the user has explicitly chosen those. Phase 1 council documents
 * this limitation in its spec.
 */
export async function streamPlainTextAiSdk(
  options: {
    system: string;
    messages: ModelMessage[];
    signal?: AbortSignal;
    mode: AiSdkMode;
  },
  ctx: AiSdkContext = {},
): Promise<AsyncIterable<string>> {
  const provider = createAiSdkProvider(options.mode);
  const modelId = await resolveAiSdkModelId("chat", options.mode, ctx);
  const result = streamText({
    abortSignal: options.signal,
    model: provider(modelId),
    messages: options.messages,
    system: options.system,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: shouldRecordTelemetryContent(),
      recordOutputs: shouldRecordTelemetryContent(),
      functionId: "council-persona-stream",
      metadata: { mode: options.mode, model: modelId },
    },
  });
  return result.textStream;
}

export async function generateStructuredDataAiSdk<TSchema extends z.ZodType>(
  {
    description,
    name,
    prompt,
    schema,
    signal,
    mode,
  }: GenerateStructuredDataOptions<TSchema> & { mode: AiSdkMode },
  // `task` kind ignores user preference (spec §3.4) — the second arg is
  // accepted for symmetry but currently unused.
  _ctx: AiSdkContext = {},
): Promise<z.infer<TSchema>> {
  void _ctx;
  const provider = createAiSdkProvider(mode);
  const recordContent = shouldRecordTelemetryContent();
  const modelId = await resolveAiSdkModelId("task", mode);
  const { output } = await generateText({
    model: provider(modelId),
    output: Output.object({ description, name, schema }),
    prompt,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: "task",
      metadata: { mode, model: modelId, name },
    },
  });

  return output as z.infer<TSchema>;
}
