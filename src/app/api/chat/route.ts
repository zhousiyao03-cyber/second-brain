import {
  getAIErrorMessage,
  streamChatResponse,
} from "@/server/ai/provider";
import { getProviderMode } from "@/server/ai/provider/mode";
import { maxStepsByMode } from "@/server/ai/provider/types";
import {
  normalizeMessages,
  sanitizeMessages,
} from "@/server/ai/chat-system-prompt";
import { buildChatContext, chatInputSchema } from "@/server/ai/chat-prepare";
import { auth } from "@/lib/auth";
import { isAuthBypassEnabled } from "@/server/auth/request-session";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
import { getEntitlements } from "@/server/billing/entitlements";
import { enqueueChatTask } from "@/server/ai/chat-enqueue";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";
import { startAskTimer } from "@/server/ai/ask-timing";
import {
  buildAskAiTools,
  getOrCreateUrlBudget,
} from "@/server/ai/tools";
import { adaptTextStreamToUiMessageStream } from "@/server/ai/legacy-stream-adapter";

export const maxDuration = 30;

export async function POST(req: Request) {
  const timer = startAskTimer("/api/chat");

  // Auth bypass for E2E testing — gated on NODE_ENV !== "production".
  let userId: string | null = null;
  if (!isAuthBypassEnabled()) {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
    const entitlements = await getEntitlements(userId);
    const { allowed } = await checkAiRateLimit(
      userId,
      entitlements.limits.askAiPerDay,
    );
    if (!allowed) {
      return Response.json(
        { error: "Daily AI usage limit reached. Please try again tomorrow." },
        { status: 429 }
      );
    }
  }
  timer.mark("auth");

  const body = await req.json();
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  timer.mark("parse");

  try {
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
      const messages = sanitizeMessages(
        await normalizeMessages(parsed.data.messages)
      );
      const sourceScope = parsed.data.sourceScope ?? "all";
      // TODO(ask-ai M1/M2 follow-up): daemon mode currently ignores
      // contextNoteText and pinnedSources. Inline editor Ask AI uses stream
      // mode (sourceScope "direct"), so this is acceptable until the inline
      // feature also needs to run against daemon mode.
      const { taskId } = await enqueueChatTask({
        userId,
        messages,
        sourceScope,
      });
      if (!isAuthBypassEnabled()) {
        void recordAiUsage(userId).catch(() => undefined);
      }
      timer.mark("enqueue");
      timer.end({ mode: "daemon" });
      return Response.json({ taskId, mode: "daemon" });
    }
    // ────────────────────────────────────────────────────────────────

    const { system, messages } = await buildChatContext(parsed.data, userId);
    timer.mark("buildContext");

    const mode = getProviderMode();
    // Tool-calling only on the AI SDK path. Codex / hosted-pool / daemon
    // continue running single-turn — we run them through the legacy
    // adapter so the front-end transport stays uniform. Spec §5.3.
    const supportsTools =
      (mode === "openai" || mode === "local") && Boolean(userId);

    let tools: ReturnType<typeof buildAskAiTools> | undefined;
    let toolSystemPreamble = "";
    if (supportsTools && userId) {
      const conversationId = parsed.data.id ?? crypto.randomUUID();
      const ctx = {
        userId,
        conversationId,
        urlBudget: getOrCreateUrlBudget(conversationId),
      };
      tools = buildAskAiTools(ctx);
      toolSystemPreamble =
        `\n\n---\n\n` +
        `You have access to tools to extend your reach beyond the initial ` +
        `context above:\n` +
        `- searchKnowledge(query, scope?, topK?): re-query the user's ` +
        `notes/bookmarks via hybrid retrieval. Use when the preamble ` +
        `does not have enough material.\n` +
        `- readNote(noteId): fetch the full body of a note that ` +
        `searchKnowledge returned. Use when a snippet is not enough.\n` +
        `- fetchUrl(url): fetch and extract readable text from a public ` +
        `URL. Each conversation has a hard budget of 3 distinct URLs ` +
        `total — spend them only when necessary.\n` +
        `Do not exceed ${maxStepsByMode(mode)} steps. Stop calling tools ` +
        `as soon as you can answer.`;
    }

    const response = await streamChatResponse(
      {
        messages,
        sessionId: parsed.data.id,
        signal: req.signal,
        system: system + toolSystemPreamble,
        tools,
        maxSteps: tools ? maxStepsByMode(mode) : undefined,
      },
      { userId },
    );
    timer.mark("streamReady");
    timer.end({ mode: tools ? "stream-tools" : "stream" });

    // Record usage (fire-and-forget, don't block the response)
    if (!isAuthBypassEnabled() && userId) {
      void recordAiUsage(userId).catch(() => undefined);
    }

    // The AI-SDK path (with or without tools) already returns a UI
    // message stream Response via toUIMessageStreamResponse(); only the
    // codex / hosted-pool / daemon legacy paths need the adapter.
    if (!supportsTools) {
      return adaptTextStreamToUiMessageStream(response);
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
