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
    captureMarkdownNote: async () => ({
      noteId: "note-2",
      folderId: "folder-1",
      title: "Markdown Title",
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

  it("forwards save_to_knosi folder argument to captureAiNote", async () => {
    let receivedFolder: string | null | undefined = "<unset>";
    const result = await callKnosiMcpTool(
      {
        userId: "u1",
        name: "save_to_knosi",
        arguments: {
          sourceApp: "bagu-skill",
          folder: "八股文",
          messages: [{ role: "assistant", content: "Card" }],
        },
      },
      makeDeps({
        captureAiNote: async (input) => {
          receivedFolder = input.folder ?? null;
          return { noteId: "n1", folderId: "folder-bagu", title: "T" };
        },
      })
    );
    expect(receivedFolder).toBe("八股文");
    expect(result).toEqual({ noteId: "n1", folderId: "folder-bagu", title: "T" });
  });

  it("omits folder from captureAiNote when arg absent", async () => {
    let receivedFolder: string | null | undefined = "<unset>";
    await callKnosiMcpTool(
      {
        userId: "u1",
        name: "save_to_knosi",
        arguments: {
          sourceApp: "claude-web",
          messages: [{ role: "user", content: "Q?" }],
        },
      },
      makeDeps({
        captureAiNote: async (input) => {
          receivedFolder = input.folder;
          return { noteId: "n1", folderId: "f1", title: "T" };
        },
      })
    );
    expect(receivedFolder).toBeUndefined();
  });

  it("forwards create_note title/body/folder to captureMarkdownNote", async () => {
    let received: { title?: string; body?: string; folder?: string | null } = {};
    const result = await callKnosiMcpTool(
      {
        userId: "u1",
        name: "create_note",
        arguments: {
          title: "Daily Digest",
          body: "# Hello\n\nWorld",
          folder: "Reports",
        },
      },
      makeDeps({
        captureMarkdownNote: async (input) => {
          received = {
            title: input.title,
            body: input.body,
            folder: input.folder ?? null,
          };
          return { noteId: "n42", folderId: "f-reports", title: input.title };
        },
      })
    );
    expect(received).toEqual({
      title: "Daily Digest",
      body: "# Hello\n\nWorld",
      folder: "Reports",
    });
    expect(result).toEqual({
      noteId: "n42",
      folderId: "f-reports",
      title: "Daily Digest",
    });
  });

  it("create_note coerces missing title/body to empty strings", async () => {
    let received: { title?: string; body?: string } = {};
    const result = await callKnosiMcpTool(
      {
        userId: "u1",
        name: "create_note",
        arguments: {},
      },
      makeDeps({
        captureMarkdownNote: async (input) => {
          received = { title: input.title, body: input.body };
          return { noteId: "n0", folderId: "f0", title: "Untitled" };
        },
      })
    );
    expect(received).toEqual({ title: "", body: "" });
    expect(isPlainObject(result)).toBe(true);
  });
});
