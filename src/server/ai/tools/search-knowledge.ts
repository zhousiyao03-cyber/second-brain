/**
 * `searchKnowledge` tool — lets the LLM run a fresh hybrid-RAG retrieval
 * against the user's notes + bookmarks mid-conversation. Wraps
 * `retrieveAgenticContext` (BM25 + Milvus + cross-encoder reranker, see
 * `agentic-rag.ts`) and projects each result down to a compact shape:
 * `{id, title, type, snippet (≤600 chars), score}`.
 *
 * Spec §4.1.
 *
 * Note on the abort signal: `retrieveAgenticContext` does NOT currently
 * accept an AbortSignal. We don't refactor it here (YAGNI — the call already
 * runs against in-memory caches and is fast). The signal is still honored
 * implicitly because the caller's `streamText` will tear down the whole
 * stream pipeline when the request aborts.
 */

import { tool } from "ai";
import { z } from "zod/v4";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import type { AskAiToolContext } from "./context";

const SNIPPET_LIMIT = 600;

export function makeSearchKnowledgeTool(ctx: AskAiToolContext) {
  return tool({
    description:
      "Search the user's personal knowledge base (notes + bookmarks) by " +
      "hybrid retrieval (BM25 + semantic + reranker). Use when the initial " +
      "context provided in the system prompt is insufficient to answer.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      scope: z.enum(["all", "notes", "bookmarks"]).optional().default("all"),
      topK: z.number().int().min(1).max(10).optional().default(5),
    }),
    execute: async ({ query, scope, topK }) => {
      const items = await retrieveAgenticContext(query, {
        userId: ctx.userId,
        scope: scope as AskAiSourceScope,
      });

      // Project down: the LLM does not need chunk indices / section paths
      // here — those are useful for the preamble but they bloat the tool
      // result. Cap at topK and clip the snippet so we don't blow the
      // context window.
      const projected = items.slice(0, topK).map((item) => ({
        id: item.sourceId,
        title: item.sourceTitle,
        type: item.sourceType,
        snippet: item.content.slice(0, SNIPPET_LIMIT),
        score: item.score,
      }));

      return { items: projected };
    },
  });
}
