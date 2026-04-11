import { and, eq, inArray } from "drizzle-orm";
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
import { db } from "@/server/db";
import { bookmarks, notes } from "@/server/db/schema";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
import { enqueueChatTask } from "@/server/ai/chat-enqueue";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";
import { guardBot } from "@/server/botid-guard";

export const maxDuration = 30;

const pinnedSourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "bookmark"]),
});

const chatInputSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()),
  sourceScope: z.enum(ASK_AI_SOURCE_SCOPES).optional(),
  contextNoteText: z.string().max(32_000).optional(),
  pinnedSources: z.array(pinnedSourceSchema).max(10).optional(),
  preferStructuredBlocks: z.boolean().optional(),
});

/**
 * SECURITY: Always scoped by userId. AUTH_BYPASS path resolves to
 * userId="test-user" in the route handler below. Never trust the client's
 * title; we always refetch it from the db row.
 */
async function resolvePinnedSources(
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
        title: row.title ?? "未命名笔记",
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
        and(
          eq(bookmarks.userId, userId),
          inArray(bookmarks.id, bookmarkIds)
        )
      );
    for (const row of rows) {
      const body =
        (row.content ?? "").trim() ||
        (row.summary ?? "").trim() ||
        (row.url ?? "");
      items.push({
        id: row.id,
        title: row.title ?? row.url ?? "未命名收藏",
        type: "bookmark",
        content: body,
      });
    }
  }

  return items;
}

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

export async function POST(req: Request) {
  const botBlock = await guardBot();
  if (botBlock) return botBlock;

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
      // TODO(ask-ai M1/M2 follow-up): daemon mode currently ignores
      // contextNoteText and pinnedSources. Inline editor Ask AI uses stream
      // mode (sourceScope "direct"), so this is acceptable until the inline
      // feature also needs to run against daemon mode.
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
      // SECURITY: RAG must be scoped to the current user. Both
      // retrieveAgenticContext and retrieveContext are fail-closed and
      // will return [] if userId is null (e.g. AUTH_BYPASS E2E runs).
      const agenticContext = await retrieveAgenticContext(userQuery, {
        scope: sourceScope,
        userId,
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
          : (
              await retrieveContext(userQuery, {
                scope: sourceScope,
                userId,
              })
            ).map((item) => ({
              content: item.content,
              id: item.id,
              title: item.title,
              type: item.type,
            }));
    }

    const pinnedSources = await resolvePinnedSources(
      parsed.data.pinnedSources ?? [],
      userId
    );

    const response = await streamChatResponse({
      messages,
      sessionId: parsed.data.id,
      signal: req.signal,
      system: buildSystemPrompt(context, sourceScope, {
        contextNoteText: parsed.data.contextNoteText,
        pinnedSources,
        preferStructuredBlocks: parsed.data.preferStructuredBlocks,
      }),
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
