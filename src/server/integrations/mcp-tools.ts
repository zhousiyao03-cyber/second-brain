import { captureAiNote, captureMarkdownNote } from "./ai-capture";
import {
  getKnowledgeItem,
  listRecentKnowledge,
  searchKnowledge,
} from "./knowledge-read";
import { createLearningCard } from "./learning-card";
import {
  listPreferences,
  setPreference,
  deletePreference,
} from "./preferences-store";

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
  {
    name: "create_learning_card",
    description:
      "Create a learning card in the user's Knosi learning module. Use this " +
      "for interview-prep Q+A cards, theory review notes, and other content " +
      "the user wants to study and re-read over time. Cards are grouped by " +
      "topic name; new topics are created on first use. Body is markdown.",
    inputSchema: {
      type: "object",
      properties: {
        topicName: {
          type: "string",
          description:
            "Topic name to group cards under (e.g. 'React 原理', '浏览器渲染'). " +
            "Created on first use; reused for subsequent cards.",
        },
        title: {
          type: "string",
          description: "Card title — usually the question or concept name.",
        },
        body: {
          type: "string",
          description:
            "Markdown content of the card. Headings, lists, code blocks, " +
            "tables, and inline formatting (bold/italic/code/links) are " +
            "supported.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering and grouping inside a topic.",
        },
      },
      required: ["topicName", "title", "body"],
    },
  },
  {
    name: "knosi_pref_list",
    description:
      "List the user's cross-agent preferences from Knosi. Call once at session start. " +
      "Pass `scope` to filter ('global' or 'project:<slug>'); omit to fetch all.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            "Optional scope filter. 'global' for global preferences or 'project:<slug>' for a specific project.",
        },
      },
    },
  },
  {
    name: "knosi_pref_set",
    description:
      "Create or update a cross-agent preference. Upserts on (scope, key). " +
      "Use when the user instructs a persistent constraint (e.g. 'always use pnpm').",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "'global' or 'project:<slug>'",
        },
        key: {
          type: "string",
          description: "snake_case identifier, e.g. 'package_manager'",
        },
        value: {
          type: "string",
          description: "Free-form constraint text, multi-line allowed.",
        },
        description: {
          type: "string",
          description: "Optional human-readable note for the UI.",
        },
      },
      required: ["scope", "key", "value"],
    },
  },
  {
    name: "knosi_pref_delete",
    description:
      "Delete a cross-agent preference by (scope, key). Use when the user revokes a constraint.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        key: { type: "string" },
      },
      required: ["scope", "key"],
    },
  },
] as const;

export interface KnosiMcpDeps {
  searchKnowledge: typeof searchKnowledge;
  listRecentKnowledge: typeof listRecentKnowledge;
  getKnowledgeItem: typeof getKnowledgeItem;
  captureAiNote: typeof captureAiNote;
  captureMarkdownNote: typeof captureMarkdownNote;
  createLearningCard: typeof createLearningCard;
  listPreferences: typeof listPreferences;
  setPreference: typeof setPreference;
  deletePreference: typeof deletePreference;
}

export const defaultDeps: KnosiMcpDeps = {
  searchKnowledge,
  listRecentKnowledge,
  getKnowledgeItem,
  captureAiNote,
  captureMarkdownNote,
  createLearningCard,
  listPreferences,
  setPreference,
  deletePreference,
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
    case "create_learning_card":
      return deps.createLearningCard({
        userId: input.userId,
        topicName: String(input.arguments.topicName ?? ""),
        title: String(input.arguments.title ?? ""),
        body: String(input.arguments.body ?? ""),
        tags: Array.isArray(input.arguments.tags)
          ? input.arguments.tags.filter(
              (tag): tag is string => typeof tag === "string"
            )
          : undefined,
      });
    case "knosi_pref_list": {
      const scope =
        typeof input.arguments.scope === "string"
          ? input.arguments.scope
          : undefined;
      const items = await deps.listPreferences({
        userId: input.userId,
        ...(scope !== undefined ? { scope } : {}),
      });
      return { items };
    }
    case "knosi_pref_set": {
      const result = await deps.setPreference({
        userId: input.userId,
        scope: String(input.arguments.scope ?? ""),
        key: String(input.arguments.key ?? ""),
        value: String(input.arguments.value ?? ""),
        description:
          typeof input.arguments.description === "string"
            ? input.arguments.description
            : undefined,
      });
      return { id: result.id, created: result.created };
    }
    case "knosi_pref_delete": {
      const result = await deps.deletePreference({
        userId: input.userId,
        scope: String(input.arguments.scope ?? ""),
        key: String(input.arguments.key ?? ""),
      });
      return { deleted: result.deleted };
    }
    default:
      throw new Error(`Unsupported MCP tool: ${input.name}`);
  }
}
