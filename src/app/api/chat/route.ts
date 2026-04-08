import type { ModelMessage } from "ai";
import { z } from "zod/v4";
import { ASK_AI_SOURCE_SCOPES } from "@/lib/ask-ai";
import { retrieveAgenticContext } from "@/server/ai/agentic-rag";
import { retrieveContext } from "@/server/ai/rag";
import {
  getAIErrorMessage,
  streamChatResponse,
} from "@/server/ai/provider";
import {
  buildSystemPrompt,
  getUserMessageText,
  normalizeMessages,
  sanitizeMessages,
  type RetrievedKnowledgeItem,
} from "@/server/ai/chat-system-prompt";
import { auth } from "@/lib/auth";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
import { enqueueChatTask } from "@/server/ai/chat-enqueue";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";

export const maxDuration = 30;

const chatInputSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()),
  sourceScope: z.enum(ASK_AI_SOURCE_SCOPES).optional(),
});

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

export async function POST(req: Request) {
  // Auth bypass for E2E testing
  let userId: string | null = null;
  if (process.env.AUTH_BYPASS !== "true") {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
    const { allowed } = await checkAiRateLimit(userId);
    if (!allowed) {
      return Response.json(
        { error: "Daily AI usage limit reached. Please try again tomorrow." },
        { status: 429 }
      );
    }
  }

  const body = await req.json();
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const messages = sanitizeMessages(
      await normalizeMessages(parsed.data.messages)
    );
    const sourceScope = parsed.data.sourceScope ?? "all";

    // ─── Daemon branch ─────────────────────────────────────────────
    if (shouldUseDaemonForChat()) {
      if (!userId) {
        // AUTH_BYPASS=true path: the queue requires a userId, so reject
        // daemon mode entirely in E2E/bypass environments. Tests should
        // run with AI_PROVIDER=codex instead.
        return Response.json(
          { error: "Daemon chat mode is not available in AUTH_BYPASS environments" },
          { status: 400 }
        );
      }
      const { taskId } = await enqueueChatTask({
        userId,
        messages,
        sourceScope,
      });
      if (process.env.AUTH_BYPASS !== "true") {
        void recordAiUsage(userId).catch(() => undefined);
      }
      return Response.json({ taskId, mode: "daemon" });
    }
    // ────────────────────────────────────────────────────────────────

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const userQuery = getUserMessageText(lastUserMessage);

    const skipRag =
      sourceScope === "direct" ||
      SKIP_RAG_KEYWORDS.some((kw) => userQuery.includes(kw));
    let context: RetrievedKnowledgeItem[] = [];

    if (!skipRag) {
      const agenticContext = await retrieveAgenticContext(userQuery, {
        scope: sourceScope,
      });

      context =
        agenticContext.length > 0
          ? agenticContext.map((item) => ({
              chunkId: item.chunkId,
              chunkIndex: item.chunkIndex,
              content: item.content,
              id: item.sourceId,
              sectionPath: item.sectionPath,
              title: item.sourceTitle,
              type: item.sourceType,
            }))
          : (await retrieveContext(userQuery, { scope: sourceScope })).map(
              (item) => ({
                content: item.content,
                id: item.id,
                title: item.title,
                type: item.type,
              })
            );
    }

    const response = await streamChatResponse({
      messages,
      sessionId: parsed.data.id,
      signal: req.signal,
      system: buildSystemPrompt(context, sourceScope),
    });

    // Record usage (fire-and-forget, don't block the response)
    if (process.env.AUTH_BYPASS !== "true" && userId) {
      void recordAiUsage(userId).catch(() => undefined);
    }

    return response;
  } catch (error) {
    const isInvalidInput =
      error instanceof Error &&
      error.message.includes("Invalid chat message format");

    return Response.json(
      {
        error: getAIErrorMessage(
          error,
          isInvalidInput ? "Invalid input" : "AI chat request failed"
        ),
      },
      { status: isInvalidInput ? 400 : 500 }
    );
  }
}
