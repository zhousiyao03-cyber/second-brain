import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod/v4";
import {
  generateStructuredDataAiSdk,
  runChatStream,
  streamChatAiSdk,
} from "./ai-sdk";
import type { ResolvedProvider } from "./types";

afterEach(() => vi.restoreAllMocks());

function makeOpenAi(
  model = "gpt-4o",
): Extract<ResolvedProvider, { kind: "openai-compatible" }> {
  return {
    kind: "openai-compatible",
    providerId: "p1",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-test",
    modelId: model,
  };
}

function makeDeepseek(
  model = "deepseek-v4-flash",
): Extract<ResolvedProvider, { kind: "openai-compatible" }> {
  return {
    kind: "openai-compatible",
    providerId: "p-ds",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: "sk-test",
    modelId: model,
  };
}

describe("streamChatAiSdk", () => {
  it("posts to the resolved baseURL and uses the resolved model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        'data: {"type":"text","value":"ok"}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const result = await streamChatAiSdk({
      provider: makeOpenAi("gpt-4o-mini"),
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    // streamText() is lazy — force the underlying request to fire by
    // fully draining the resulting Response body.
    const reader = result.response.body?.getReader();
    if (reader) {
      while (!(await reader.read()).done) {
        // drain
      }
    }

    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("api.openai.com/v1");
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body ?? "{}"));
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("respects local kind base URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    );
    const result = await streamChatAiSdk({
      provider: {
        kind: "local",
        providerId: "p2",
        label: "Ollama",
        baseURL: "http://127.0.0.1:11434/v1",
        modelId: "qwen2.5:14b",
      },
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    const reader = result.response.body?.getReader();
    if (reader) {
      while (!(await reader.read()).done) {
        // drain
      }
    }

    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("127.0.0.1:11434");
  });
});

describe("runChatStream", () => {
  it("returns the raw streamText result with a textStream property", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        'data: {"type":"text","value":"ok"}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const result = runChatStream({
      provider: makeOpenAi("gpt-4o-mini"),
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toBeDefined();
    expect(typeof result.textStream).toBe("object");

    for await (const _chunk of result.textStream) {
      // drain
    }

    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("generateStructuredDataAiSdk — DeepSeek json_object fallback", () => {
  function mockChatJson(content: string) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }

  it("sends response_format=json_object (NOT json_schema) for deepseek.com baseURL", async () => {
    const fetchSpy = mockChatJson('{"emotion":"gentle","text":"hi","hooks":["a","b","c"]}');
    const schema = z.object({
      emotion: z.string(),
      text: z.string(),
      hooks: z.array(z.string()).length(3),
    });

    await generateStructuredDataAiSdk({
      provider: makeDeepseek(),
      description: "Pip reply",
      name: "pip_response",
      prompt: "Say hi",
      schema,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("api.deepseek.com");
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body ?? "{}"));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("does NOT use json_object fallback for OpenAI", async () => {
    const fetchSpy = mockChatJson('{"emotion":"gentle","text":"hi","hooks":["a","b","c"]}');
    const schema = z.object({
      emotion: z.string(),
      text: z.string(),
      hooks: z.array(z.string()).length(3),
    });

    await generateStructuredDataAiSdk({
      provider: makeOpenAi("gpt-4o-mini"),
      description: "Pip reply",
      name: "pip_response",
      prompt: "Say hi",
      schema,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body ?? "{}"));
    // OpenAI continues to use Output.object → json_schema
    expect(body.response_format?.type).toBe("json_schema");
  });

  it("validates parsed JSON against zod schema and returns typed value", async () => {
    mockChatJson('{"shouldSpeak":true,"priority":0.8,"reason":"on point"}');
    const schema = z.object({
      shouldSpeak: z.boolean(),
      priority: z.number(),
      reason: z.string(),
    });
    const result = await generateStructuredDataAiSdk({
      provider: makeDeepseek(),
      description: "classifier",
      name: "shouldSpeakDecision",
      prompt: "decide",
      schema,
    });
    expect(result).toEqual({
      shouldSpeak: true,
      priority: 0.8,
      reason: "on point",
    });
  });

  it("strips ```json fences before parsing", async () => {
    mockChatJson('```json\n{"shouldSpeak":false,"priority":0.1,"reason":"ok"}\n```');
    const schema = z.object({
      shouldSpeak: z.boolean(),
      priority: z.number(),
      reason: z.string(),
    });
    const result = await generateStructuredDataAiSdk({
      provider: makeDeepseek(),
      description: "classifier",
      name: "shouldSpeakDecision",
      prompt: "decide",
      schema,
    });
    expect(result.shouldSpeak).toBe(false);
  });

  it("throws a descriptive error if provider returns non-JSON", async () => {
    mockChatJson("Sorry, I can't comply.");
    const schema = z.object({ shouldSpeak: z.boolean() });
    await expect(
      generateStructuredDataAiSdk({
        provider: makeDeepseek(),
        description: "classifier",
        name: "shouldSpeakDecision",
        prompt: "decide",
        schema,
      }),
    ).rejects.toThrow(/non-JSON|JSON/);
  });
});
