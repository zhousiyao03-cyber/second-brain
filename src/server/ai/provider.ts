import { createOpenAI } from "@ai-sdk/openai";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import { generateText, Output, streamText, type ModelMessage } from "ai";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";

type AIProviderMode = "local" | "openai" | "codex";
type GenerationKind = "chat" | "task";

type CodexProfile = {
  access: string;
  accountId?: string;
  expires: number;
  provider?: string;
  refresh: string;
  type?: string;
  [key: string]: unknown;
};

type CodexAuthStore = {
  order?: Record<string, string[]>;
  profiles?: Record<string, CodexProfile>;
  usageStats?: Record<string, unknown>;
  version?: unknown;
  [key: string]: unknown;
};

type CodexSseEvent = {
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

type StreamChatOptions = {
  messages: ModelMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  system: string;
};

type GenerateStructuredDataOptions<TSchema extends z.ZodType> = {
  description: string;
  name: string;
  prompt: string;
  schema: TSchema;
  signal?: AbortSignal;
};

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_CHAT_MODEL = "qwen2.5:14b";
const DEFAULT_LOCAL_TASK_MODEL = "qwen2.5:14b";
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TASK_MODEL = "gpt-5.4";
const DEFAULT_CODEX_CHAT_MODEL = "gpt-5.4";
const DEFAULT_CODEX_TASK_MODEL = "gpt-5.4";
const DEFAULT_CODEX_PROVIDER = "openai-codex";
const DEFAULT_CODEX_PROFILE_ID = "openai-codex:default";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_CODEX_AUTH_STORE_PATH = join(
  homedir(),
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);
const CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const CODEX_JSON_SYSTEM_PROMPT =
  "You are a structured data generator. Always return exactly one JSON object with no markdown fences or extra prose.";

function resolveValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readOpenclawConfig() {
  return readJsonFile<{
    agents?: { defaults?: { model?: { primary?: string } } };
    auth?: { order?: Record<string, string[]> };
  }>(resolveValue(process.env.OPENCLAW_CONFIG_PATH) ?? DEFAULT_OPENCLAW_CONFIG_PATH);
}

function resolveCodexProfileId() {
  const configuredProfileId = resolveValue(
    process.env.CODEX_AUTH_PROFILE_ID,
    process.env.OPENCLAW_CODEX_PROFILE_ID
  );
  if (configuredProfileId) {
    return configuredProfileId;
  }

  const openclawConfig = readOpenclawConfig();
  const orderedProfiles = openclawConfig?.auth?.order?.[DEFAULT_CODEX_PROVIDER];
  return orderedProfiles?.[0] ?? DEFAULT_CODEX_PROFILE_ID;
}

function resolveCodexAuthStorePath() {
  return (
    resolveValue(
      process.env.CODEX_AUTH_STORE_PATH,
      process.env.OPENCLAW_CODEX_AUTH_STORE_PATH
    ) ?? DEFAULT_CODEX_AUTH_STORE_PATH
  );
}

function resolveCodexBaseUrl() {
  return resolveValue(process.env.CODEX_BASE_URL) ?? DEFAULT_CODEX_BASE_URL;
}

function resolveCodexModelId(kind: GenerationKind) {
  const openclawConfig = readOpenclawConfig();
  const primaryModel = openclawConfig?.agents?.defaults?.model?.primary;
  const openclawModelId =
    primaryModel?.startsWith(`${DEFAULT_CODEX_PROVIDER}/`)
      ? primaryModel.slice(`${DEFAULT_CODEX_PROVIDER}/`.length)
      : undefined;
  const fallbackModelId =
    kind === "chat" ? DEFAULT_CODEX_CHAT_MODEL : DEFAULT_CODEX_TASK_MODEL;

  return (
    resolveValue(
      kind === "chat"
        ? process.env.CODEX_CHAT_MODEL
        : process.env.CODEX_TASK_MODEL,
      process.env.CODEX_MODEL,
      openclawModelId
    ) ?? fallbackModelId
  );
}

function readCodexAuthStore() {
  const storePath = resolveCodexAuthStorePath();
  const authStore = readJsonFile<CodexAuthStore>(storePath);

  if (!authStore) {
    return null;
  }

  return { authStore, storePath };
}

function hasCodexAuthProfile() {
  const store = readCodexAuthStore();
  if (!store?.authStore.profiles) {
    return false;
  }

  return Boolean(store.authStore.profiles[resolveCodexProfileId()]);
}

function getProviderMode(): AIProviderMode {
  const explicitMode = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicitMode === "codex" || explicitMode === "openai-codex") {
    return "codex";
  }
  if (explicitMode === "openai") {
    return "openai";
  }
  if (explicitMode === "local") {
    return "local";
  }

  if (hasCodexAuthProfile()) {
    return "codex";
  }

  if (resolveValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }

  return "local";
}

function createAiSdkProvider(mode: Exclude<AIProviderMode, "codex">) {
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

function resolveAiSdkModelId(
  kind: GenerationKind,
  mode: Exclude<AIProviderMode, "codex">
) {
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

function extractAccountId(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      throw new Error("Invalid token");
    }

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const accountId = decoded?.[CODEX_JWT_CLAIM_PATH]?.chatgpt_account_id;

    if (!accountId || typeof accountId !== "string") {
      throw new Error("No account ID in token");
    }

    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from Codex OAuth token.");
  }
}

async function resolveCodexApiKey() {
  const store = readCodexAuthStore();
  if (!store) {
    throw new Error(
      `Missing Codex auth store at ${resolveCodexAuthStorePath()}. Please sign in with OpenClaw first.`
    );
  }

  const profileId = resolveCodexProfileId();
  const profile = store.authStore.profiles?.[profileId];

  if (!profile) {
    throw new Error(
      `Missing Codex OAuth profile "${profileId}" in ${store.storePath}. Please sign in with OpenClaw first.`
    );
  }

  if (profile.provider && profile.provider !== DEFAULT_CODEX_PROVIDER) {
    throw new Error(
      `Profile "${profileId}" is not an OpenAI Codex profile. Expected provider "${DEFAULT_CODEX_PROVIDER}".`
    );
  }

  const result = await getOAuthApiKey(DEFAULT_CODEX_PROVIDER, {
    [DEFAULT_CODEX_PROVIDER]: profile,
  });

  if (!result) {
    throw new Error(
      `Failed to read Codex OAuth credentials for profile "${profileId}".`
    );
  }

  const refreshedProfile: CodexProfile = {
    ...profile,
    ...result.newCredentials,
    type: "oauth",
    provider: DEFAULT_CODEX_PROVIDER,
  };

  if (
    JSON.stringify(refreshedProfile) !== JSON.stringify(profile) &&
    store.authStore.profiles
  ) {
    store.authStore.profiles[profileId] = refreshedProfile;
    writeFileSync(store.storePath, `${JSON.stringify(store.authStore, null, 2)}\n`);
  }

  return {
    accountId: extractAccountId(result.apiKey),
    apiKey: result.apiKey,
  };
}

function resolveCodexUrl() {
  const normalized = resolveCodexBaseUrl().replace(/\/+$/, "");

  if (normalized.endsWith("/codex/responses")) {
    return normalized;
  }

  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`;
  }

  return `${normalized}/codex/responses`;
}

function buildCodexHeaders({
  accountId,
  apiKey,
  sessionId,
}: {
  accountId: string;
  apiKey: string;
  sessionId?: string;
}) {
  const headers = new Headers({
    Accept: "text/event-stream",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    "User-Agent": `second-brain (${os.platform()} ${os.release()}; ${os.arch()})`,
    "chatgpt-account-id": accountId,
    originator: "pi",
  });

  if (sessionId) {
    headers.set("session_id", sessionId);
  }

  return headers;
}

function getTextFromModelMessageContent(content: ModelMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function buildCodexSystemPrompt(system: string, messages: ModelMessage[]) {
  const systemParts = [system];

  for (const message of messages) {
    if (message.role !== "system") {
      continue;
    }

    const text = getTextFromModelMessageContent(message.content).trim();
    if (text) {
      systemParts.push(text);
    }
  }

  return systemParts.filter(Boolean).join("\n\n");
}

function buildCodexConversationInput(messages: ModelMessage[]) {
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const text = getTextFromModelMessageContent(message.content).trim();
    if (!text) {
      continue;
    }

    input.push({
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text,
          ...(message.role === "assistant" ? { annotations: [] } : {}),
        },
      ],
    });
  }

  return input;
}

function buildCodexRequestBody({
  input,
  modelId,
  sessionId,
  stream,
  systemPrompt,
}: {
  input: Array<Record<string, unknown>>;
  modelId: string;
  sessionId?: string;
  stream: boolean;
  systemPrompt: string;
}) {
  return {
    include: ["reasoning.encrypted_content"],
    input,
    instructions: systemPrompt,
    model: modelId,
    parallel_tool_calls: true,
    prompt_cache_key: sessionId,
    store: false,
    stream,
    text: { verbosity: "medium" },
    tool_choice: "auto",
  };
}

async function extractCodexError(response: Response) {
  const rawText = await response.text().catch(() => "");

  try {
    const parsed = JSON.parse(rawText) as {
      detail?: string;
      error?: { message?: string };
      message?: string;
    };

    return (
      parsed.error?.message?.trim() ||
      parsed.detail?.trim() ||
      parsed.message?.trim() ||
      rawText.trim() ||
      response.statusText
    );
  } catch {
    return rawText.trim() || response.statusText;
  }
}

async function fetchCodexResponse({
  body,
  sessionId,
  signal,
}: {
  body: Record<string, unknown>;
  sessionId?: string;
  signal?: AbortSignal;
}) {
  const { accountId, apiKey } = await resolveCodexApiKey();
  const response = await fetch(resolveCodexUrl(), {
    method: "POST",
    headers: buildCodexHeaders({ accountId, apiKey, sessionId }),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await extractCodexError(response));
  }

  if (!response.body) {
    throw new Error("Codex response body is empty.");
  }

  return response;
}

async function* parseCodexSse(response: Response): AsyncGenerator<CodexSseEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");

      while (separatorIndex !== -1) {
        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
          .trim();

        if (data && data !== "[DONE]") {
          yield JSON.parse(data) as CodexSseEvent;
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}

    try {
      reader.releaseLock();
    } catch {}
  }
}

function getCodexItemText(item: CodexSseEvent["item"]) {
  return (
    item?.content
      ?.filter((contentPart) => contentPart.type === "output_text")
      .map((contentPart) => contentPart.text ?? "")
      .join("") ?? ""
  );
}

function getCodexEventError(event: CodexSseEvent) {
  if (event.type === "error") {
    return event.message ?? "Codex request failed.";
  }

  if (event.type === "response.failed") {
    return event.response?.error?.message ?? "Codex response failed.";
  }

  return null;
}

async function collectCodexText(response: Response) {
  let text = "";
  let sawDelta = false;

  for await (const event of parseCodexSse(response)) {
    const errorMessage = getCodexEventError(event);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    if (event.type === "response.output_text.delta" && event.delta) {
      sawDelta = true;
      text += event.delta;
    }

    if (event.type === "response.output_item.done" && !sawDelta) {
      text += getCodexItemText(event.item);
    }

    if (
      event.type === "response.completed" ||
      event.type === "response.done" ||
      event.type === "response.incomplete"
    ) {
      break;
    }
  }

  return text;
}

function createCodexTextStreamResponse(response: Response) {
  const encoder = new TextEncoder();
  let sawDelta = false;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of parseCodexSse(response)) {
          const errorMessage = getCodexEventError(event);
          if (errorMessage) {
            throw new Error(errorMessage);
          }

          if (event.type === "response.output_text.delta" && event.delta) {
            sawDelta = true;
            controller.enqueue(encoder.encode(event.delta));
          }

          if (event.type === "response.output_item.done" && !sawDelta) {
            const itemText = getCodexItemText(event.item);
            if (itemText) {
              controller.enqueue(encoder.encode(itemText));
            }
          }

          if (
            event.type === "response.completed" ||
            event.type === "response.done" ||
            event.type === "response.incomplete"
          ) {
            break;
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function buildStructuredJsonPrompt<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
}: Omit<GenerateStructuredDataOptions<TSchema>, "signal">) {
  return [
    `Return exactly one JSON object for "${name}".`,
    description,
    "Do not include markdown fences, explanations, or any text outside the JSON object.",
    "The JSON must satisfy this schema exactly:",
    JSON.stringify(z.toJSONSchema(schema), null, 2),
    "",
    "Task:",
    prompt,
  ].join("\n");
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return candidate;
  }

  return candidate.slice(start, end + 1);
}

async function generateStructuredDataWithCodex<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
}: GenerateStructuredDataOptions<TSchema>): Promise<z.infer<TSchema>> {
  const response = await fetchCodexResponse({
    body: buildCodexRequestBody({
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: buildStructuredJsonPrompt({
            description,
            name,
            prompt,
            schema,
          }) }],
        },
      ],
      modelId: resolveCodexModelId("task"),
      stream: true,
      systemPrompt: CODEX_JSON_SYSTEM_PROMPT,
    }),
    signal,
  });
  const text = await collectCodexText(response);

  try {
    return schema.parse(JSON.parse(extractJsonObject(text)));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Codex returned invalid JSON for ${name}: ${details}`);
  }
}

export async function streamChatResponse({
  messages,
  sessionId,
  signal,
  system,
}: StreamChatOptions) {
  const mode = getProviderMode();

  if (mode !== "codex") {
    const provider = createAiSdkProvider(mode);
    const result = streamText({
      abortSignal: signal,
      model: provider(resolveAiSdkModelId("chat", mode)),
      messages,
      system,
    });

    return result.toTextStreamResponse();
  }

  const response = await fetchCodexResponse({
    body: buildCodexRequestBody({
      input: buildCodexConversationInput(messages),
      modelId: resolveCodexModelId("chat"),
      sessionId,
      stream: true,
      systemPrompt: buildCodexSystemPrompt(system, messages),
    }),
    sessionId,
    signal,
  });

  return createCodexTextStreamResponse(response);
}

export async function generateStructuredData<TSchema extends z.ZodType>({
  description,
  name,
  prompt,
  schema,
  signal,
}: GenerateStructuredDataOptions<TSchema>): Promise<z.infer<TSchema>> {
  const mode = getProviderMode();

  if (mode === "codex") {
    return generateStructuredDataWithCodex({
      description,
      name,
      prompt,
      schema,
      signal,
    });
  }

  const provider = createAiSdkProvider(mode);
  const { output } = await generateText({
    model: provider(resolveAiSdkModelId("task", mode)),
    output: Output.object({
      description,
      name,
      schema,
    }),
    prompt,
    abortSignal: signal,
  });

  return output as z.infer<TSchema>;
}

export function getAISetupHint() {
  const mode = getProviderMode();

  if (mode === "codex") {
    return `请确认 OpenClaw 已完成 Codex OAuth 登录，并检查 ${resolveCodexAuthStorePath()} 中的 ${resolveCodexProfileId()} profile 是否有效。`;
  }

  if (mode === "openai") {
    return "请检查 OPENAI_API_KEY、OPENAI_MODEL 以及 OpenAI 账户额度是否正常。";
  }

  return "请检查本地模型服务是否已启动，并确认 AI_BASE_URL 与 AI_MODEL 配置正确。";
}

export function getChatAssistantIdentity() {
  const mode = getProviderMode();

  if (mode === "codex") {
    const modelId = resolveCodexModelId("chat");
    return `你是 Second Brain 的 AI 助手，当前运行在 OpenAI Codex（${modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明你在使用 Codex。`;
  }

  if (mode === "openai") {
    const modelId = resolveAiSdkModelId("chat", "openai");
    return `你是 Second Brain 的 AI 助手，当前运行在 OpenAI API 配置的模型（${modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明当前模型。`;
  }

  const modelId = resolveAiSdkModelId("chat", "local");
  return `你是 Second Brain 的 AI 助手，当前运行在本地 AI 模型服务（${modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明当前模型。`;
}

export function getAIErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
