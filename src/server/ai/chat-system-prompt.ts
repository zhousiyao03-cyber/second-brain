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
  /**
   * Opt-in flag from the inline Ask AI popover. When true, the system
   * prompt asks the model to (optionally) wrap rich answers in
   * <ai_blocks> XML containing a JSON array of Tiptap JSONContent nodes,
   * so `parseAiBlocks` can insert them as structured blocks instead of
   * losing fidelity through a plaintext → markdown round trip. Plain
   * short answers stay as plain text.
   */
  preferStructuredBlocks?: boolean;
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

function withStructuredBlocksInstructions(
  base: string,
  options?: BuildSystemPromptOptions
) {
  if (!options?.preferStructuredBlocks) return base;
  return `${base}

---

**结构化输出（首选）**：如果你的回答包含多种块类型（标题、列表、代码块、引用、callout 等），**请优先**把整个回答包在 \`<ai_blocks>\` XML 标签里，内容是一个 JSON 数组，每个元素是 Tiptap ProseMirror 的 JSONContent 节点。示例：

<ai_blocks>
[
  {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"要点"}]},
  {"type":"paragraph","content":[{"type":"text","text":"一句介绍。"}]},
  {"type":"bulletList","content":[
    {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"第一点"}]}]},
    {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"第二点"}]}]}
  ]},
  {"type":"codeBlock","attrs":{"language":"ts"},"content":[{"type":"text","text":"const x = 1;"}]}
]
</ai_blocks>

规则：
- JSON 必须是有效可解析的数组，直接放在 \`<ai_blocks>\` 和 \`</ai_blocks>\` 之间，不要加 markdown 代码围栏。
- 支持的节点类型：paragraph, heading (attrs.level 1-6), bulletList, orderedList, listItem, codeBlock (attrs.language optional), blockquote。
- 如果回答只是一段简单的纯文本或一两个段落，不必包，用普通文本即可，调用方会自动回退到 markdown 解析。
- 如果你已经按知识库规则在末尾输出了 \`<!-- sources:... -->\` 隐藏标记，它应该**在** \`</ai_blocks>\` **之后**。`;
}

function finalizePrompt(base: string, options?: BuildSystemPromptOptions) {
  return withStructuredBlocksInstructions(
    withPinnedSources(withNoteContext(base, options), options),
    options
  );
}

/**
 * Stable per-conversation system prompt — does NOT depend on per-question
 * RAG retrieval, the user's currently-open note, or pinned @-sources. Those
 * volatile pieces ride along with the user message via {@link buildUserPreamble}.
 *
 * Stability matters for `claude --resume <sessionId>`: a resumed session
 * locks its system prompt to whatever was set when it was first created.
 * If we keep RAG context here, every question's freshly-retrieved chunks
 * would force a different system prompt and break session reuse.
 */
export interface StableSystemPromptOptions {
  preferStructuredBlocks?: boolean;
}

export async function buildSystemPromptStable(
  sourceScope: AskAiSourceScope,
  userId: string | null,
  options?: StableSystemPromptOptions
): Promise<string> {
  const identityLine = userId
    ? await getChatAssistantIdentity(userId)
    : "你是 Second Brain 的 AI 助手。";

  const baseRules = sourceScope === "direct"
    ? `${identityLine} 当前请求选择了直接回答模式，不要引用知识库，直接用中文回答用户的问题，简洁准确。`
    : `${identityLine} 你帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。

回答规则：
1. 优先基于用户消息中提供的知识库内容回答；如果不足以回答，可以补充你自己的知识，但要说明哪些是来自知识库、哪些是补充。
2. 如果你使用了用户提供的知识库内容，必须在回复的最末尾追加一个隐藏标记，格式为：
<!-- sources:[{"id":"来源ID","type":"note或bookmark","title":"来源标题"}] -->
只包含你实际引用的来源，不要包含未使用的来源。
3. 隐藏标记必须是回复的最后一行，前面有一个空行。`;

  return withStructuredBlocksInstructions(baseRules, {
    preferStructuredBlocks: options?.preferStructuredBlocks,
  });
}

/**
 * Per-question preamble carrying RAG-retrieved knowledge, the current note
 * the user is editing, and any @-pinned sources. Returned as a plain string
 * meant to be prepended onto the latest user message via
 * {@link injectPreambleIntoLatestUser}.
 *
 * Returns "" when there is nothing to add, in which case the caller should
 * leave the user message untouched.
 */
export interface BuildUserPreambleInput {
  retrieved: RetrievedKnowledgeItem[];
  sourceScope: AskAiSourceScope;
  pinnedSources: RetrievedKnowledgeItem[];
  contextNoteText?: string;
}

export function buildUserPreamble(input: BuildUserPreambleInput): string {
  const parts: string[] = [];

  if (input.retrieved.length > 0) {
    const scopeHint =
      input.sourceScope === "notes"
        ? "当前只检索了笔记。"
        : input.sourceScope === "bookmarks"
          ? "当前只检索了收藏。"
          : "当前检索了笔记和收藏。";

    const knowledgeBlock = input.retrieved
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
        return `<source id="${item.id}" type="${item.type}" title="${item.title}"${
          extraAttributes ? ` ${extraAttributes}` : ""
        }>\n${item.content}\n</source>`;
      })
      .join("\n\n");

    parts.push(`${scopeHint}

以下是从我的知识库中检索到的相关内容：

<knowledge_base>
${knowledgeBlock}
</knowledge_base>`);
  }

  const noteCtx = input.contextNoteText?.trim();
  if (noteCtx) {
    parts.push(`我当前正在编辑一个笔记。以下是笔记的当前内容（当我说"这篇笔记"、"上面这段"、"本页"时，指的就是这段内容；除非我要求，否则不要原样复述）：

<current_note>
${noteCtx.slice(0, 8000)}
</current_note>`);
  }

  if (input.pinnedSources.length > 0) {
    const block = input.pinnedSources
      .map((item) => {
        const content = (item.content ?? "").slice(0, 6000);
        return `<pinned_source id="${item.id}" type="${item.type}" title="${item.title}">\n${content}\n</pinned_source>`;
      })
      .join("\n\n");
    parts.push(`我通过 @ 钉了以下来源作为这次提问的**权威上下文**。请优先基于它们回答；如果不足以回答，再说明哪些是补充：

<pinned_sources>
${block}
</pinned_sources>`);
  }

  if (parts.length === 0) return "";

  return parts.join("\n\n---\n\n") + "\n\n---\n\n";
}

export async function buildSystemPrompt(
  context: RetrievedKnowledgeItem[],
  sourceScope: AskAiSourceScope,
  userId: string | null,
  options?: BuildSystemPromptOptions
): Promise<string> {
  const identityLine = userId
    ? await getChatAssistantIdentity(userId)
    : "你是 Second Brain 的 AI 助手。";

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
