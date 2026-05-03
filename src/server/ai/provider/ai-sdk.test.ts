import { describe, expect, it, vi, afterEach } from "vitest";
import { runChatStream, streamChatAiSdk } from "./ai-sdk";
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
