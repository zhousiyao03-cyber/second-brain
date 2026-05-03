import { observe, updateActiveObservation } from "@langfuse/tracing";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import type { RetrievedKnowledgeItem } from "@/server/ai/chat-system-prompt";

/**
 * Shared retrieval pipeline for any caller that needs ask-AI-quality grounding:
 * agentic RAG first, fall back to keyword RAG when agentic returns nothing.
 *
 * Used by chat-prepare (Ask AI) and council persona-stream so both stay in
 * lockstep — improvements to ranking/recall flow to both at once.
 */
export async function retrieveWithFallback(
  query: string,
  opts: { scope: AskAiSourceScope; userId: string | null }
): Promise<RetrievedKnowledgeItem[]> {
  if (!query.trim()) return [];

  return observe(
    async () => {
      // Privacy: do NOT include the raw user query in the retriever input —
      // updateActiveObservation flows to Langfuse regardless of the AI SDK's
      // recordInputs flag. Only ship structural metadata.
      updateActiveObservation(
        { input: { queryLength: query.length, sourceScope: opts.scope } },
        { asType: "retriever" }
      );

      const tracedAgenticRag = observe(
        () => retrieveAgenticContext(query, opts),
        { name: "agentic-rag", asType: "retriever" }
      );
      const agenticContext = await tracedAgenticRag();

      if (agenticContext.length > 0) {
        const results: RetrievedKnowledgeItem[] = agenticContext.map(
          (item) => ({
            chunkId: item.chunkId,
            chunkIndex: item.chunkIndex,
            content: item.content,
            id: item.sourceId,
            sectionPath: item.sectionPath,
            title: item.sourceTitle,
            type: item.sourceType,
          })
        );
        updateActiveObservation(
          {
            output: results.map(stripContent),
            metadata: { method: "agentic", chunkCount: results.length },
          },
          { asType: "retriever" }
        );
        return results;
      }

      const tracedKeywordRag = observe(
        () => retrieveContext(query, opts),
        { name: "keyword-rag-fallback", asType: "retriever" }
      );
      const fallbackContext = await tracedKeywordRag();

      const results: RetrievedKnowledgeItem[] = fallbackContext.map((item) => ({
        content: item.content,
        id: item.id,
        title: item.title,
        type: item.type,
      }));
      updateActiveObservation(
        {
          output: results.map(stripContent),
          metadata: {
            method: "keyword-fallback",
            chunkCount: results.length,
          },
        },
        { asType: "retriever" }
      );
      return results;
    },
    { name: "rag-retrieval", asType: "retriever" }
  )();
}

/** Privacy: strip the chunk body before exporting metadata to traces. */
function stripContent(item: RetrievedKnowledgeItem): Omit<
  RetrievedKnowledgeItem,
  "content"
> {
  const { content: _omit, ...meta } = item;
  void _omit;
  return meta;
}
