import {
  getAIErrorMessage,
  streamChatResponse,
} from "@/server/ai/provider";
import {
  normalizeMessages,
  sanitizeMessages,
} from "@/server/ai/chat-system-prompt";
import { buildChatContext, chatInputSchema } from "@/server/ai/chat-prepare";
import { auth } from "@/lib/auth";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
import { getEntitlements } from "@/server/billing/entitlements";
import { enqueueChatTask } from "@/server/ai/chat-enqueue";
import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode";

export const maxDuration = 30;

export async function POST(req: Request) {
  // Auth bypass for E2E testing
  let userId: string | null = null;
  if (process.env.AUTH_BYPASS !== "true") {
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

  const body = await req.json();
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

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
      if (process.env.AUTH_BYPASS !== "true") {
        void recordAiUsage(userId).catch(() => undefined);
      }
      return Response.json({ taskId, mode: "daemon" });
    }
    // ────────────────────────────────────────────────────────────────

    const { system, messages } = await buildChatContext(parsed.data, userId);

    const response = await streamChatResponse({
      messages,
      sessionId: parsed.data.id,
      signal: req.signal,
      system,
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
