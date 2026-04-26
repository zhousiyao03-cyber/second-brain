import { captureAiNote, captureMarkdownNote } from "./ai-capture";
import {
  getKnowledgeItem,
  listRecentKnowledge,
  searchKnowledge,
} from "./knowledge-read";

export const KNOSI_MCP_TOOLS = [
  {
    name: "search_knowledge",
    description: "Search the user's Knosi knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_knowledge_item",
    description: "Read a single note or bookmark from Knosi.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["note", "bookmark"] },
      },
      required: ["id"],
    },
  },
  {
    name: "list_recent_knowledge",
    description: "List the user's most recent Knosi notes and bookmarks.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "save_to_knosi",
    description:
      "Save an explicit AI conversation excerpt into the user's Knosi knowledge base. " +
      "Defaults to the AI Inbox folder. Pass `folder` to route the note into a named " +
      "top-level folder (created on first use).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sourceApp: { type: "string" },
        capturedAtLabel: { type: "string" },
        sourceMeta: { type: "object" },
        folder: {
          type: "string",
          description:
            "Optional top-level folder name. When non-empty after trim, the note is " +
            "filed there (folder is created if missing). Empty, whitespace-only, or " +
            "omitted = AI Inbox.",
        },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
      },
      required: ["sourceApp", "messages"],
    },
  },
  {
    name: "create_note",
    description:
      "Create a note in the user's Knosi knowledge base from raw markdown. " +
      "Use this for agent-generated content (daily summaries, scheduled reports, " +
      "research outputs). Defaults to AI Inbox; pass `folder` to file elsewhere.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: {
          type: "string",
          description:
            "Markdown content of the note. Headings, lists, links, and inline " +
            "formatting (bold/italic/code) are supported.",
        },
        folder: {
          type: "string",
          description:
            "Optional top-level folder name. Created on first use. Empty / " +
            "omitted = AI Inbox.",
        },
      },
      required: ["title", "body"],
    },
  },
] as const;

export interface KnosiMcpDeps {
  searchKnowledge: typeof searchKnowledge;
  listRecentKnowledge: typeof listRecentKnowledge;
  getKnowledgeItem: typeof getKnowledgeItem;
  captureAiNote: typeof captureAiNote;
  captureMarkdownNote: typeof captureMarkdownNote;
}

const defaultDeps: KnosiMcpDeps = {
  searchKnowledge,
  listRecentKnowledge,
  getKnowledgeItem,
  captureAiNote,
  captureMarkdownNote,
};

export async function callKnosiMcpTool(
  input: {
    userId: string;
    name: (typeof KNOSI_MCP_TOOLS)[number]["name"];
    arguments: Record<string, unknown>;
  },
  deps: KnosiMcpDeps = defaultDeps
): Promise<Record<string, unknown>> {
  switch (input.name) {
    case "search_knowledge": {
      // MCP spec requires `structuredContent` to be a JSON object (not array
      // or null), and Claude Code's MCP client enforces this strictly. Wrap
      // array/null readers here so individual reader functions can keep their
      // natural return shapes for other callers.
      const items = await deps.searchKnowledge({
        userId: input.userId,
        query: String(input.arguments.query ?? ""),
        limit:
          typeof input.arguments.limit === "number" ? input.arguments.limit : undefined,
      });
      return { items };
    }
    case "get_knowledge_item": {
      const item = await deps.getKnowledgeItem({
        userId: input.userId,
        id: String(input.arguments.id ?? ""),
        type:
          input.arguments.type === "note" || input.arguments.type === "bookmark"
            ? input.arguments.type
            : undefined,
      });
      return { item };
    }
    case "list_recent_knowledge": {
      const items = await deps.listRecentKnowledge({
        userId: input.userId,
        limit:
          typeof input.arguments.limit === "number" ? input.arguments.limit : undefined,
      });
      return { items };
    }
    case "save_to_knosi":
      return deps.captureAiNote({
        userId: input.userId,
        title:
          typeof input.arguments.title === "string" ? input.arguments.title : undefined,
        sourceApp: String(input.arguments.sourceApp ?? "claude-web"),
        capturedAtLabel:
          typeof input.arguments.capturedAtLabel === "string"
            ? input.arguments.capturedAtLabel
            : new Date().toISOString(),
        sourceMeta:
          input.arguments.sourceMeta && typeof input.arguments.sourceMeta === "object"
            ? (input.arguments.sourceMeta as Record<string, unknown>)
            : undefined,
        folder:
          typeof input.arguments.folder === "string"
            ? input.arguments.folder
            : undefined,
        messages: Array.isArray(input.arguments.messages)
          ? input.arguments.messages
              .filter(
                (message): message is { role: string; content: string } =>
                  Boolean(
                    message &&
                      typeof message === "object" &&
                      typeof (message as { role?: unknown }).role === "string" &&
                      typeof (message as { content?: unknown }).content === "string"
                  )
              )
              .map((message) => ({
                role: message.role,
                content: message.content,
              }))
          : [],
      });
    case "create_note":
      return deps.captureMarkdownNote({
        userId: input.userId,
        title: String(input.arguments.title ?? ""),
        body: String(input.arguments.body ?? ""),
        folder:
          typeof input.arguments.folder === "string"
            ? input.arguments.folder
            : undefined,
      });
    default:
      throw new Error(`Unsupported MCP tool: ${input.name}`);
  }
}
