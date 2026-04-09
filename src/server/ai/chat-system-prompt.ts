import {
  convertToModelMessages,
  modelMessageSchema,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod/v4";
import {
  type AskAiSourceScope,
  stripAssistantSourceMetadata,
} from "@/lib/ask-ai";
import { getChatAssistantIdentity } from "./provider";

export interface RetrievedKnowledgeItem {
  chunkId?: string;
  chunkIndex?: number;
  content: string;
  id: string;
  sectionPath?: string[];
  title: string;
  type: "note" | "bookmark";
}

const uiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.object({ type: z.string() }).passthrough()),
  })
  .passthrough();

export async function normalizeMessages(
  messages: unknown[]
): Promise<ModelMessage[]> {
  const uiMessages = z.array(uiMessageSchema).safeParse(messages);
  if (uiMessages.success) {
    return convertToModelMessages(
      uiMessages.data as Array<Omit<UIMessage, "id">>
    );
  }

  const modelMessages = z.array(modelMessageSchema).safeParse(messages);
  if (modelMessages.success) {
    return modelMessages.data;
  }

  throw new Error(
    "Invalid chat message format. Expected AI SDK UI messages or model messages."
  );
}

export function sanitizeMessages(messages: ModelMessage[]) {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    if (typeof message.content === "string") {
      return {
        ...message,
        content: stripAssistantSourceMetadata(message.content),
      };
    }

    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "text"
          ? {
              ...part,
              text: stripAssistantSourceMetadata(part.text),
            }
          : part
      ),
    };
  });
}

export function getUserMessageText(message: ModelMessage | undefined) {
  if (!message || message.role !== "user") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export interface BuildSystemPromptOptions {
  /**
   * Full plain text of the note the user is currently editing. When present,
   * it is appended to the system prompt as "current note context" so the
   * assistant can resolve references like "this note" / "the text above".
   * Truncated to 8000 chars to keep token usage bounded.
   */
  contextNoteText?: string;
  /**
   * Hard-pinned sources the user explicitly selected via @mention in the
   * inline Ask AI popover. These must be treated as authoritative context,
   * higher priority than RAG-retrieved context. Already scoped to the user
   * by the route handler, so no additional filtering here.
   */
  pinnedSources?: RetrievedKnowledgeItem[];
}

function withNoteContext(base: string, options?: BuildSystemPromptOptions) {
  const noteCtx = options?.contextNoteText?.trim();
  if (!noteCtx) return base;
  return `${base}

---

用户当前正在编辑一个笔记。以下是笔记的当前内容，供你理解上下文（当用户说 “这篇笔记”、“上面这段”、“本页” 时，指的就是这段内容；除非用户要求，否则不要原样复述这段内容）：

<current_note>
${noteCtx.slice(0, 8000)}
</current_note>`;
}

function withPinnedSources(base: string, options?: BuildSystemPromptOptions) {
  const pinned = options?.pinnedSources;
  if (!pinned || pinned.length === 0) return base;
  const block = pinned
    .map((item) => {
      const content = (item.content ?? "").slice(0, 6000);
      return `<pinned_source id="${item.id}" type="${item.type}" title="${item.title}">\n${content}\n</pinned_source>`;
    })
    .join("\n\n");
  return `${base}

---

用户通过 @ 手动钉住了以下 source，作为回答这个问题的**权威上下文**。请优先基于这些内容回答；如果它们不足以回答问题，再说明哪些是补充：

<pinned_sources>
${block}
</pinned_sources>`;
}

function finalizePrompt(base: string, options?: BuildSystemPromptOptions) {
  return withPinnedSources(withNoteContext(base, options), options);
}

export function buildSystemPrompt(
  context: RetrievedKnowledgeItem[],
  sourceScope: AskAiSourceScope,
  options?: BuildSystemPromptOptions
): string {
  const identityLine = getChatAssistantIdentity();

  if (context.length === 0) {
    if (sourceScope === "direct") {
      return finalizePrompt(
        `${identityLine} 当前请求选择了直接回答模式，不要引用知识库，直接用中文回答用户的问题，简洁准确。`,
        options
      );
    }

    return finalizePrompt(
      `${identityLine} 用户的知识库中没有找到相关内容，请直接用中文回答用户的问题，简洁准确。`,
      options
    );
  }

  const scopeHint =
    sourceScope === "notes"
      ? "当前只检索了笔记。"
      : sourceScope === "bookmarks"
        ? "当前只检索了收藏。"
        : "当前检索了笔记和收藏。";

  const knowledgeBlock = context
    .map((item) => {
      const extraAttributes = [
        item.chunkId ? `chunk_id="${item.chunkId}"` : null,
        typeof item.chunkIndex === "number"
          ? `chunk_index="${item.chunkIndex}"`
          : null,
        item.sectionPath?.length
          ? `section="${item.sectionPath.join(" > ")}"`
          : null,
      ]
        .filter(Boolean)
        .join(" ");

      return `<source id="${item.id}" type="${item.type}" title="${
        item.title
      }"${extraAttributes ? ` ${extraAttributes}` : ""}>\n${item.content}\n</source>`;
    })
    .join("\n\n");

  return finalizePrompt(
    `${identityLine} 你帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。

${scopeHint}

以下是从用户知识库中检索到的相关内容，请优先基于这些内容回答用户的问题：

<knowledge_base>
${knowledgeBlock}
</knowledge_base>

回答规则：
1. 优先基于知识库中的内容回答，如果知识库内容不足以回答，可以补充你自己的知识，但要说明哪些是来自知识库、哪些是补充。
2. 如果你使用了知识库中的内容，必须在回复的最末尾追加一个隐藏标记，格式为：
<!-- sources:[{"id":"来源ID","type":"note或bookmark","title":"来源标题"}] -->
只包含你实际引用的来源，不要包含未使用的来源。
3. 隐藏标记必须是回复的最后一行，前面有一个空行。`,
    options
  );
}
