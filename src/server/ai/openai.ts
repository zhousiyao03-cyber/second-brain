import { createOpenAI } from "@ai-sdk/openai";

type AIProviderMode = "local" | "openai";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_CHAT_MODEL = "qwen2.5:14b";
const DEFAULT_LOCAL_TASK_MODEL = "qwen2.5:14b";
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TASK_MODEL = "gpt-5.4";

function resolveValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function getProviderMode(): AIProviderMode {
  const explicitMode = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicitMode === "openai") return "openai";
  if (explicitMode === "local") return "local";

  return "local";
}

function createLanguageProvider(mode: AIProviderMode) {
  if (mode === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error(
        "Missing OPENAI_API_KEY. Add it to .env.local or switch AI_PROVIDER to local."
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
    baseURL: resolveValue(process.env.AI_BASE_URL, process.env.LOCAL_AI_BASE_URL) ?? DEFAULT_LOCAL_BASE_URL,
    apiKey: resolveValue(process.env.AI_API_KEY, process.env.LOCAL_AI_API_KEY) ?? "local",
  });
}

function getModelId(kind: "chat" | "task", mode: AIProviderMode) {
  if (mode === "openai") {
    const fallbackModelId = kind === "chat" ? DEFAULT_OPENAI_CHAT_MODEL : DEFAULT_OPENAI_TASK_MODEL;

    return (
      resolveValue(
        kind === "chat" ? process.env.OPENAI_CHAT_MODEL : process.env.OPENAI_TASK_MODEL,
        process.env.OPENAI_MODEL
      ) ?? fallbackModelId
    );
  }

  const fallbackModelId = kind === "chat" ? DEFAULT_LOCAL_CHAT_MODEL : DEFAULT_LOCAL_TASK_MODEL;

  return (
    resolveValue(
      kind === "chat" ? process.env.AI_CHAT_MODEL : process.env.AI_TASK_MODEL,
      kind === "chat" ? process.env.LOCAL_AI_CHAT_MODEL : process.env.LOCAL_AI_TASK_MODEL,
      process.env.AI_MODEL,
      process.env.LOCAL_AI_MODEL
    ) ?? fallbackModelId
  );
}

export function getChatModel() {
  const mode = getProviderMode();
  const provider = createLanguageProvider(mode);

  return provider(getModelId("chat", mode));
}

export function getTaskModel() {
  const mode = getProviderMode();
  const provider = createLanguageProvider(mode);

  return provider(getModelId("task", mode));
}

export function getAISetupHint() {
  const mode = getProviderMode();

  if (mode === "openai") {
    return "请检查 OPENAI_API_KEY、OPENAI_MODEL 以及 OpenAI 账户额度是否正常。";
  }

  return "请检查本地模型服务是否已启动，并确认 AI_BASE_URL 与 AI_MODEL 配置正确。";
}

export function getAIErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
