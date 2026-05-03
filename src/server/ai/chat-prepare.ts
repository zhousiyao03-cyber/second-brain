import { and, eq, inArray } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { z } from "zod/v4";
import { ASK_AI_SOURCE_SCOPES, type AskAiSourceScope } from "@/lib/ask-ai";
import { db } from "@/server/db";
import { bookmarks, notes } from "@/server/db/schema";
import { retrieveWithFallback } from "@/server/ai/retriever";
import {
  buildSystemPromptStable,
  buildUserPreamble,
  getUserMessageText,
  normalizeMessages,
  sanitizeMessages,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { injectPreambleIntoLatestUser } from "@/server/ai/inject-preamble";
import { startAskTimer } from "@/server/ai/ask-timing";

export const pinnedSourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "bookmark"]),
});

export const chatInputSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()),
  sourceScope: z.enum(ASK_AI_SOURCE_SCOPES).optional(),
  contextNoteText: z.string().max(32_000).optional(),
  pinnedSources: z.array(pinnedSourceSchema).max(10).optional(),
  preferStructuredBlocks: z.boolean().optional(),
});

export type ChatInput = z.infer<typeof chatInputSchema>;

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

export async function resolvePinnedSources(
  pins: Array<{ id: string; type: "note" | "bookmark" }>,
  userId: string | null
): Promise<RetrievedKnowledgeItem[]> {
  if (pins.length === 0 || !userId) return [];

  const noteIds = pins.filter((p) => p.type === "note").map((p) => p.id);
  const bookmarkIds = pins
    .filter((p) => p.type === "bookmark")
    .map((p) => p.id);

  const items: RetrievedKnowledgeItem[] = [];

  if (noteIds.length > 0) {
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.plainText,
      })
      .from(notes)
      .where(and(eq(notes.userId, userId), inArray(notes.id, noteIds)));
    for (const row of rows) {
      items.push({
        id: row.id,
        title: row.title ?? "Untitled note",
        type: "note",
        content: row.content ?? "",
      });
    }
  }

  if (bookmarkIds.length > 0) {
    const rows = await db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        content: bookmarks.content,
        summary: bookmarks.summary,
        url: bookmarks.url,
      })
      .from(bookmarks)
      .where(
        and(eq(bookmarks.userId, userId), inArray(bookmarks.id, bookmarkIds))
      );
    for (const row of rows) {
      const body =
        (row.content ?? "").trim() ||
        (row.summary ?? "").trim() ||
        (row.url ?? "");
      items.push({
        id: row.id,
        title: row.title ?? row.url ?? "Untitled bookmark",
        type: "bookmark",
        content: body,
      });
    }
  }

  return items;
}

export interface ChatContextBundle {
  system: string;
  messages: ModelMessage[];
  sourceScope: AskAiSourceScope;
}

export async function buildChatContext(
  input: ChatInput,
  userId: string | null
): Promise<ChatContextBundle> {
  const timer = startAskTimer("chat-prepare");

  const messages = sanitizeMessages(await normalizeMessages(input.messages));
  const sourceScope = input.sourceScope ?? "all";

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const userQuery = getUserMessageText(lastUserMessage);
  timer.mark("normalize");

  const skipRag =
    sourceScope === "direct" ||
    SKIP_RAG_KEYWORDS.some((kw) => userQuery.includes(kw));

  let context: RetrievedKnowledgeItem[] = [];

  if (!skipRag) {
    context = await retrieveWithFallback(userQuery, {
      scope: sourceScope,
      userId,
    });
  }
  timer.mark("rag");

  const pinnedSources = await resolvePinnedSources(
    input.pinnedSources ?? [],
    userId
  );
  timer.mark("pinned");

  const system = await buildSystemPromptStable(sourceScope, userId, {
    preferStructuredBlocks: input.preferStructuredBlocks,
  });
  const preamble = buildUserPreamble({
    retrieved: context,
    sourceScope,
    pinnedSources,
    contextNoteText: input.contextNoteText,
  });
  const augmentedMessages = injectPreambleIntoLatestUser(messages, preamble);

  timer.end({
    skipRag,
    ctxItems: context.length,
    pinned: pinnedSources.length,
    scope: sourceScope,
  });

  return { system, messages: augmentedMessages, sourceScope };
}
