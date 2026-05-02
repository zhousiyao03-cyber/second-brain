import type { ModelMessage } from "ai";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import { publishDaemonTaskNotification } from "@/server/ai/daemon-task-notifications";
import {
  buildSystemPromptStable,
  buildUserPreamble,
  getUserMessageText,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { injectPreambleIntoLatestUser } from "@/server/ai/inject-preamble";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { observe, updateActiveObservation } from "@langfuse/tracing";
import { startAskTimer } from "@/server/ai/ask-timing";

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
  const timer = startAskTimer("enqueue");

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
      // Privacy: see chat-prepare.ts — do not ship raw query to Langfuse.
      updateActiveObservation({ input: { queryLength: userQuery.length, sourceScope } }, { asType: "retriever" });

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
  timer.mark("rag");

  const systemPrompt = await buildSystemPromptStable(sourceScope, userId, {
    preferStructuredBlocks: false,
  });
  const preamble = buildUserPreamble({
    retrieved: context,
    sourceScope,
    pinnedSources: [],
  });
  const augmentedMessages = injectPreambleIntoLatestUser(messages, preamble);
  const model = process.env.CLAUDE_CODE_CHAT_MODEL?.trim() || "opus";

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId,
    status: "queued",
    taskType: "chat",
    sourceScope,
    messages: JSON.stringify(augmentedMessages),
    systemPrompt,
    model,
  });
  timer.mark("dbInsert");

  await publishDaemonTaskNotification({
    kind: "wake",
    userId,
    taskType: "chat",
  });
  timer.mark("notify");

  timer.end({
    skipRag,
    ctxItems: context.length,
    scope: sourceScope,
  });

  return { taskId };
}
