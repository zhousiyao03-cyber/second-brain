import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type { z } from "zod/v4";
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

export async function streamChatAiSdk(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): Promise<StreamChatAiSdkResult> {
  const { provider, messages, signal, system, tools, maxSteps } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  const result = streamText({
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
    modelId: provider.modelId,
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

export async function generateStructuredDataAiSdk<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema> & {
    provider: AiSdkResolvable;
  },
): Promise<z.infer<TSchema>> {
  const { provider, description, name, prompt, schema, signal } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
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
