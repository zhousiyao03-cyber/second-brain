import { describe, expect, it } from "vitest";
import { callKnosiMcpTool, type KnosiMcpDeps } from "./mcp-tools";

// MCP `structuredContent` must be a JSON object (not array/null). Claude Code's
// MCP client rejects array-shaped responses with
// `invalid_type: expected record`. These tests pin the dispatcher's wrapping
// invariant for every tool so a future refactor can't silently regress it.

function makeDeps(overrides: Partial<KnosiMcpDeps> = {}): KnosiMcpDeps {
  return {
    searchKnowledge: async () => [],
    listRecentKnowledge: async () => [],
    getKnowledgeItem: async () => null,
    captureAiNote: async () => ({
      noteId: "note-1",
      folderId: "folder-1",
      title: "Title",
    }),
    ...overrides,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

describe("callKnosiMcpTool structuredContent shape", () => {
  it("wraps search_knowledge array as { items }", async () => {
    const rows = [
      {
        id: "a",
        type: "note" as const,
        title: "A",
        snippet: "",
        updatedAt: null,
      },
    ];
    const result = await callKnosiMcpTool(
      {
        userId: "u1",
        name: "search_knowledge",
        arguments: { query: "hello" },
      },
      makeDeps({ searchKnowledge: async () => rows })
    );
    expect(isPlainObject(result)).toBe(true);
    expect(result).toEqual({ items: rows });
  });

  it("wraps list_recent_knowledge empty array as { items: [] }", async () => {
    const result = await callKnosiMcpTool(
      { userId: "u1", name: "list_recent_knowledge", arguments: {} },
      makeDeps()
    );
    expect(isPlainObject(result)).toBe(true);
    expect(result).toEqual({ items: [] });
  });

  it("wraps get_knowledge_item null as { item: null }", async () => {
    const result = await callKnosiMcpTool(
      { userId: "u1", name: "get_knowledge_item", arguments: { id: "x" } },
      makeDeps()
    );
    expect(isPlainObject(result)).toBe(true);
    expect(result).toEqual({ item: null });
  });

  it("passes through captureAiNote object result", async () => {
    const expected = {
      noteId: "n1",
      folderId: "f1",
      title: "Saved",
    };
    const result = await callKnosiMcpTool(
      {
        userId: "u1",
        name: "save_to_knosi",
        arguments: {
          sourceApp: "claude-code",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      makeDeps({ captureAiNote: async () => expected })
    );
    expect(isPlainObject(result)).toBe(true);
    expect(result).toEqual(expected);
  });
});
