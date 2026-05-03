import { createOpenAI } from "@ai-sdk/openai";
import {
  defaultSettingsMiddleware,
  extractJsonMiddleware,
  generateText,
  Output,
  stepCountIs,
  streamText,
  wrapLanguageModel,
} from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod/v4";
import type {
  GenerateStructuredDataOptions,
  ResolvedProvider,
  StreamChatOptions,
} from "./types";

type AiSdkResolvable = Extract<
  ResolvedProvider,
  { kind: "openai-compatible" | "local" }
>;

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

function createAiSdkProvider(p: AiSdkResolvable) {
  if (p.kind === "openai-compatible") {
    return createOpenAI({
      name: p.label,
      baseURL: p.baseURL,
      apiKey: p.apiKey,
    });
  }
  // local — Ollama / LM Studio. The OpenAI client requires *some* apiKey,
  // even if the server doesn't validate it.
  return createOpenAI({
    name: p.label,
    baseURL: p.baseURL,
    apiKey: "local",
  });
}

export type StreamChatAiSdkResult = {
  /** Underlying UI-message-stream Response from `toUIMessageStreamResponse()`. */
  response: Response;
  /** Resolved model id actually passed to the LLM provider. Spec §6.2 / §6.3. */
  modelId: string;
};

/**
 * Internal helper: run the underlying `streamText(...)` call. Returns the
 * raw streamText result so callers can either:
 *   - wrap it as a UI Message Stream Response (production /api/chat path), or
 *   - consume `textStream` / `toolCalls` / `toolResults` directly (eval harness).
 *
 * Keeping a single source of truth here is what lets the eval harness exercise
 * the exact same model invocation production uses without duplicating config.
 */
export function runChatStream(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): ReturnType<typeof streamText> {
  const { provider, messages, signal, system, tools, maxSteps } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  return streamText({
    abortSignal: signal,
    model: sdk.chat(provider.modelId),
    messages,
    system,
    // Tools are only meaningful with `stopWhen` — without it the SDK
    // defaults to stepCountIs(1) and the loop never proceeds past the
    // first tool_call. We only attach the tool set when caller explicitly
    // opted in; otherwise streamText keeps its old behavior.
    ...(hasTools
      ? { tools, stopWhen: stepCountIs(maxSteps ?? 1) }
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
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        ...(hasTools ? { hasTools: true, maxSteps: maxSteps ?? 1 } : {}),
      },
    },
  });
}

export async function streamChatAiSdk(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): Promise<StreamChatAiSdkResult> {
  const result = runChatStream(options);
  // The UI message stream protocol carries tool-call / tool-result parts
  // that the front-end's <ChatMessageParts> component needs to render
  // step badges. Single-turn callers don't get tool parts so the
  // payload is functionally equivalent to a text stream.
  return {
    response: result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[ai-sdk stream error]", error);
        if (error instanceof Error) return error.message;
        return typeof error === "string" ? error : JSON.stringify(error);
      },
    }),
    modelId: options.provider.modelId,
  };
}

/**
 * Plain-text streaming for internal callers that want an AsyncIterable<string>
 * (not an HTTP Response). Used by the council module's per-persona streaming.
 */
export async function streamPlainTextAiSdk(options: {
  system: string;
  messages: ModelMessage[];
  signal?: AbortSignal;
  provider: AiSdkResolvable;
}): Promise<AsyncIterable<string>> {
  const sdk = createAiSdkProvider(options.provider);
  const result = streamText({
    abortSignal: options.signal,
    model: sdk.chat(options.provider.modelId),
    messages: options.messages,
    system: options.system,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: shouldRecordTelemetryContent(),
      recordOutputs: shouldRecordTelemetryContent(),
      functionId: "council-persona-stream",
      metadata: {
        kind: options.provider.kind,
        providerLabel: options.provider.label,
        model: options.provider.modelId,
      },
    },
  });
  return result.textStream;
}

/**
 * Some OpenAI-compatible backends (notably DeepSeek) reject the
 * `response_format: { type: "json_schema", ... }` shape that Vercel AI SDK's
 * `Output.object()` produces, returning:
 *   "This response_format type is unavailable now."
 * They DO support `response_format: { type: "json_object" }` (no schema),
 * which the OpenAI provider emits when given `responseFormat: { type: "json" }`
 * with no schema attached. We force that shape via middleware and validate
 * the parsed text against the caller's zod schema ourselves.
 *
 * Detection is based on baseURL (the most reliable signal — label is
 * user-supplied) and matches `*deepseek.com*`. New providers that share the
 * same limitation should be added to `needsJsonObjectFallback`.
 */
function needsJsonObjectFallback(p: AiSdkResolvable): boolean {
  if (p.kind !== "openai-compatible") return false;
  try {
    const host = new URL(p.baseURL).hostname.toLowerCase();
    return host.includes("deepseek.com");
  } catch {
    return false;
  }
}

export async function generateStructuredDataAiSdk<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema> & {
    provider: AiSdkResolvable;
  },
): Promise<z.infer<TSchema>> {
  const { provider, description, name, prompt, schema, signal } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();

  if (needsJsonObjectFallback(provider)) {
    return generateStructuredDataJsonObject({
      provider,
      sdk,
      description,
      name,
      prompt,
      schema,
      signal,
      recordContent,
    });
  }

  const { output } = await generateText({
    model: sdk.chat(provider.modelId),
    output: Output.object({ description, name, schema }),
    prompt,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: "task",
      metadata: {
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        name,
      },
    },
  });
  return output as z.infer<TSchema>;
}

async function generateStructuredDataJsonObject<TSchema extends z.ZodType>(args: {
  provider: AiSdkResolvable;
  sdk: ReturnType<typeof createAiSdkProvider>;
  description: string;
  name: string;
  prompt: string;
  schema: TSchema;
  signal?: AbortSignal;
  recordContent: boolean;
}): Promise<z.infer<TSchema>> {
  const {
    provider,
    sdk,
    description,
    name,
    prompt,
    schema,
    signal,
    recordContent,
  } = args;

  // zod v4 → JSON Schema text. We embed it in the prompt so the model knows
  // the exact shape; DeepSeek's json_object mode does not enforce a schema
  // server-side, so this is our only schema signal.
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  const schemaText = JSON.stringify(jsonSchema);

  const promptWithJsonInstruction =
    `${prompt}\n\n` +
    `---\n` +
    `Reply with a single JSON object named "${name}" — ${description}.\n` +
    `It MUST validate against this JSON Schema:\n` +
    `${schemaText}\n\n` +
    `Output rules:\n` +
    `- Return ONLY the JSON object. No prose, no markdown fences, no commentary.\n` +
    `- Use double quotes for all keys and string values.\n` +
    `- Do not include trailing commas.\n` +
    `- The word "json" appears here so the API accepts json_object mode.`;

  const wrapped = wrapLanguageModel({
    model: sdk.chat(provider.modelId),
    middleware: [
      // Force `response_format: { type: "json_object" }` on the wire.
      // The OpenAI provider only emits json_object (not json_schema) when
      // `responseFormat.type === "json"` AND no schema is attached.
      defaultSettingsMiddleware({
        settings: { responseFormat: { type: "json" } },
      }),
      // Strip ```json fences if the model adds them anyway.
      extractJsonMiddleware(),
    ],
  });

  const { text } = await generateText({
    model: wrapped,
    prompt: promptWithJsonInstruction,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: "task",
      metadata: {
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        name,
        jsonObjectFallback: true,
      },
    },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Provider returned non-JSON in json_object mode (${provider.label}, ${provider.modelId}): ${(err as Error).message}. Raw text: ${text.slice(0, 200)}`,
    );
  }
  return schema.parse(parsed) as z.infer<TSchema>;
}
