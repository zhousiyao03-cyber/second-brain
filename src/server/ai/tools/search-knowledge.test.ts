import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/agentic-rag", () => ({
  retrieveAgenticContext: vi.fn(),
}));

import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { makeSearchKnowledgeTool } from "./search-knowledge";

const mockedRetrieve = vi.mocked(retrieveAgenticContext);

const ctx = {
  userId: "user-1",
  conversationId: "conv-1",
  urlBudget: { count: 0, urlsHit: new Set<string>() },
};

function buildResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    blockType: null,
    chunkId: "chunk-1",
    chunkIndex: 0,
    content: "lorem ipsum dolor sit amet ".repeat(100),
    score: 0.9,
    sectionPath: [],
    sourceId: "note-1",
    sourceTitle: "RAG notes",
    sourceType: "note" as const,
    ...overrides,
  };
}

// `tool({ execute })` from the AI SDK returns an object whose `execute` is
// the function we want to test. The signature gates on the second arg
// (ToolCallOptions); we pass a minimal stub that satisfies the runtime.
type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

const stubOptions = {
  toolCallId: "tc-test",
  messages: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("makeSearchKnowledgeTool", () => {
  it("projects retrieval results to the LLM-facing shape", async () => {
    mockedRetrieve.mockResolvedValueOnce([
      buildResult({ sourceId: "n1", sourceTitle: "first" }),
      buildResult({ sourceId: "n2", sourceTitle: "second" }),
    ]);

    const t = makeSearchKnowledgeTool(ctx) as ExecutableTool;
    const result = await t.execute!(
      { query: "rag", scope: "all", topK: 5 },
      stubOptions,
    );

    expect(mockedRetrieve).toHaveBeenCalledWith("rag", {
      userId: "user-1",
      scope: "all",
    });
    expect(result).toMatchObject({
      items: [
        { id: "n1", title: "first", type: "note", score: 0.9 },
        { id: "n2", title: "second", type: "note", score: 0.9 },
      ],
    });
  });

  it("clips snippets to 600 chars", async () => {
    mockedRetrieve.mockResolvedValueOnce([buildResult()]);
    const t = makeSearchKnowledgeTool(ctx) as ExecutableTool;
    const result = (await t.execute!(
      { query: "rag", scope: "all", topK: 5 },
      stubOptions,
    )) as { items: Array<{ snippet: string }> };
    expect(result.items[0].snippet.length).toBe(600);
  });

  it("respects topK by truncating result list", async () => {
    mockedRetrieve.mockResolvedValueOnce([
      buildResult({ sourceId: "n1" }),
      buildResult({ sourceId: "n2" }),
      buildResult({ sourceId: "n3" }),
    ]);
    const t = makeSearchKnowledgeTool(ctx) as ExecutableTool;
    const result = (await t.execute!(
      { query: "rag", scope: "all", topK: 2 },
      stubOptions,
    )) as { items: Array<{ id: string }> };
    expect(result.items.map((it) => it.id)).toEqual(["n1", "n2"]);
  });
});
