import { captureAiNote } from "./ai-capture";
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
    description: "Save an explicit AI conversation excerpt into the user's AI Inbox.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sourceApp: { type: "string" },
        capturedAtLabel: { type: "string" },
        sourceMeta: { type: "object" },
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
] as const;

export async function callKnosiMcpTool(input: {
  userId: string;
  name: (typeof KNOSI_MCP_TOOLS)[number]["name"];
  arguments: Record<string, unknown>;
}) {
  switch (input.name) {
    case "search_knowledge":
      return searchKnowledge({
        userId: input.userId,
        query: String(input.arguments.query ?? ""),
        limit:
          typeof input.arguments.limit === "number" ? input.arguments.limit : undefined,
      });
    case "get_knowledge_item":
      return getKnowledgeItem({
        userId: input.userId,
        id: String(input.arguments.id ?? ""),
        type:
          input.arguments.type === "note" || input.arguments.type === "bookmark"
            ? input.arguments.type
            : undefined,
      });
    case "list_recent_knowledge":
      return listRecentKnowledge({
        userId: input.userId,
        limit:
          typeof input.arguments.limit === "number" ? input.arguments.limit : undefined,
      });
    case "save_to_knosi":
      return captureAiNote({
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
    default:
      throw new Error(`Unsupported MCP tool: ${input.name}`);
  }
}
