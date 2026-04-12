import type { ModelMessage } from "ai";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import {
  buildSystemPrompt,
  getUserMessageText,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { observe, updateActiveObservation } from "@langfuse/tracing";

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

interface EnqueueInput {
  userId: string;
  messages: ModelMessage[];
  sourceScope: AskAiSourceScope;
}

export async function enqueueChatTask({
  userId,
  messages,
  sourceScope,
}: EnqueueInput): Promise<{ taskId: string }> {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const userQuery = getUserMessageText(lastUserMessage);

  const skipRag =
    sourceScope === "direct" ||
    SKIP_RAG_KEYWORDS.some((keyword) => userQuery.includes(keyword));

  let context: RetrievedKnowledgeItem[] = [];

  if (!skipRag) {
    const tracedRetrieval = observe(async () => {
      updateActiveObservation({ input: { query: userQuery, sourceScope } }, { asType: "retriever" });

      const tracedAgenticRag = observe(
        () => retrieveAgenticContext(userQuery, { scope: sourceScope, userId }),
        { name: "agentic-rag", asType: "retriever" },
      );
      const agenticContext = await tracedAgenticRag();

      if (agenticContext.length > 0) {
        const results = agenticContext.map((item) => ({
          chunkId: item.chunkId,
          chunkIndex: item.chunkIndex,
          content: item.content,
          id: item.sourceId,
          score: item.score,
          sectionPath: item.sectionPath,
          title: item.sourceTitle,
          type: item.sourceType,
        }));
        updateActiveObservation({
          output: results.map(({ content, ...meta }) => meta),
          metadata: { method: "agentic", chunkCount: results.length },
        }, { asType: "retriever" });
        return results;
      }

      const tracedKeywordRag = observe(
        () => retrieveContext(userQuery, { scope: sourceScope, userId }),
        { name: "keyword-rag-fallback", asType: "retriever" },
      );
      const fallbackContext = await tracedKeywordRag();

      const results = fallbackContext.map((item) => ({
        content: item.content,
        id: item.id,
        title: item.title,
        type: item.type,
      }));
      updateActiveObservation({
        output: results.map(({ content, ...meta }) => meta),
        metadata: { method: "keyword-fallback", chunkCount: results.length },
      }, { asType: "retriever" });
      return results;
    }, { name: "rag-retrieval", asType: "retriever" });

    context = await tracedRetrieval();
  }

  const systemPrompt = buildSystemPrompt(context, sourceScope);
  const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId,
    status: "queued",
    taskType: "chat",
    sourceScope,
    messages: JSON.stringify(messages),
    systemPrompt,
    model,
  });

  return { taskId };
}
