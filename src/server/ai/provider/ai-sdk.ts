import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, streamText } from "ai";
import type { z } from "zod/v4";
import { resolveValue } from "./shared";
import type {
  AIProviderMode,
  GenerateStructuredDataOptions,
  GenerationKind,
  StreamChatOptions,
} from "./types";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_CHAT_MODEL = "qwen2.5:14b";
const DEFAULT_LOCAL_TASK_MODEL = "qwen2.5:14b";
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TASK_MODEL = "gpt-5.4";

type AiSdkMode = Exclude<AIProviderMode, "codex" | "claude-code-daemon">;

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

export function resolveAiSdkModelId(kind: GenerationKind, mode: AiSdkMode) {
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

export function streamChatAiSdk({
  messages,
  signal,
  system,
  mode,
  tools,
  maxSteps,
}: StreamChatOptions & { mode: AiSdkMode }) {
  const provider = createAiSdkProvider(mode);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  const result = streamText({
    abortSignal: signal,
    model: provider(resolveAiSdkModelId("chat", mode)),
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
        ...(hasTools ? { hasTools: true, maxSteps: maxSteps ?? 1 } : {}),
      },
    },
  });

  // The UI message stream protocol carries tool-call / tool-result parts
  // that the front-end's <ChatMessageParts> component needs to render
  // step badges. Single-turn callers don't get tool parts so the
  // payload is functionally equivalent to a text stream.
  return result.toUIMessageStreamResponse();
}

export async function generateStructuredDataAiSdk<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
  mode,
}: GenerateStructuredDataOptions<TSchema> & { mode: AiSdkMode }): Promise<z.infer<TSchema>> {
  const provider = createAiSdkProvider(mode);
  const recordContent = shouldRecordTelemetryContent();
  const { output } = await generateText({
    model: provider(resolveAiSdkModelId("task", mode)),
    output: Output.object({ description, name, schema }),
    prompt,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: "task",
      metadata: { mode, name },
    },
  });

  return output as z.infer<TSchema>;
}
