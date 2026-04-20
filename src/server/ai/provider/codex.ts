import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import type { ModelMessage } from "ai";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { Buffer } from "node:buffer";
import type { z } from "zod/v4";
import {
  buildStructuredJsonPrompt,
  extractJsonObject,
  getTextFromModelMessageContent,
  resolveValue,
} from "./shared";
import {
  DEFAULT_CODEX_PROVIDER,
  normalizeCodexAuthStorePath,
  readCodexAuthStore,
  readOpenclawConfig,
  resolveCodexAuthStorePath,
  resolveCodexProfileId,
} from "./mode";
import type {
  CodexProfile,
  CodexSseEvent,
  GenerateStructuredDataOptions,
  GenerationKind,
  StreamChatOptions,
} from "./types";

const DEFAULT_CODEX_CHAT_MODEL = "gpt-5.4";
const DEFAULT_CODEX_TASK_MODEL = "gpt-5.4";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const CODEX_JSON_SYSTEM_PROMPT =
  "You are a structured data generator. Always return exactly one JSON object with no markdown fences or extra prose.";

function resolveCodexBaseUrl() {
  return resolveValue(process.env.CODEX_BASE_URL) ?? DEFAULT_CODEX_BASE_URL;
}

export function resolveCodexModelId(kind: GenerationKind) {
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

async function resolveCodexApiKey(authStorePathOverride?: string) {
  const store = readCodexAuthStore(authStorePathOverride);
  if (!store) {
    throw new Error(
      `Missing Codex auth store at ${resolveCodexAuthStorePath(authStorePathOverride)}. Please sign in with OpenClaw first.`
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
  authStorePathOverride,
  body,
  sessionId,
  signal,
}: {
  authStorePathOverride?: string;
  body: Record<string, unknown>;
  sessionId?: string;
  signal?: AbortSignal;
}) {
  const { accountId, apiKey } = await resolveCodexApiKey(authStorePathOverride);
  const response = await fetch(resolveCodexUrl(), {
    method: "POST",
    headers: buildCodexHeaders({ accountId, apiKey, sessionId }),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const message = await extractCodexError(response);
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
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

export async function streamChatCodex(
  { messages, sessionId, signal, system }: StreamChatOptions,
  opts?: { authStorePath?: string },
) {
  const response = await fetchCodexResponse({
    authStorePathOverride: opts?.authStorePath
      ? normalizeCodexAuthStorePath(opts.authStorePath)
      : undefined,
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

export async function generateStructuredDataCodex<TSchema extends z.ZodType>(
  { description, name, prompt, schema, signal }: GenerateStructuredDataOptions<TSchema>,
  opts?: { authStorePath?: string },
): Promise<z.infer<TSchema>> {
  const response = await fetchCodexResponse({
    authStorePathOverride: opts?.authStorePath
      ? normalizeCodexAuthStorePath(opts.authStorePath)
      : undefined,
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
