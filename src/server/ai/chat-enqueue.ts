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
    // SECURITY: scope RAG to this user. Fail-closed inside the helpers.
    const agenticContext = await retrieveAgenticContext(userQuery, {
      scope: sourceScope,
      userId,
    });

    if (agenticContext.length > 0) {
      context = agenticContext.map((item) => ({
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        content: item.content,
        id: item.sourceId,
        sectionPath: item.sectionPath,
        title: item.sourceTitle,
        type: item.sourceType,
      }));
    } else {
      const fallbackContext = await retrieveContext(userQuery, {
        scope: sourceScope,
        userId,
      });
      context = fallbackContext.map((item) => ({
        content: item.content,
        id: item.id,
        title: item.title,
        type: item.type,
      }));
    }
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
