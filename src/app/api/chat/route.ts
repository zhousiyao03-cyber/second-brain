import {
  getAIErrorMessage,
  streamChatResponse,
  MissingAiRoleError,
} from "@/server/ai/provider";
import { resolveAiCall } from "@/server/ai/provider/resolve";
import { maxStepsForKind } from "@/server/ai/provider/types";
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
import { startAskTimer } from "@/server/ai/ask-timing";
import {
  buildAskAiTools,
  getOrCreateUrlBudget,
} from "@/server/ai/tools";
import { adaptTextStreamToUiMessageStream } from "@/server/ai/legacy-stream-adapter";

export const maxDuration = 30;

function withDebugHeaders(
  source: Response,
  meta: { kind: string; modelId: string | null },
): Response {
  const headers = new Headers(source.headers);
  headers.set("X-Knosi-Kind", meta.kind);
  if (meta.modelId) {
    headers.set("X-Knosi-Model", meta.modelId);
  }
  return new Response(source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

export async function POST(req: Request) {
  const timer = startAskTimer("/api/chat");

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

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let provider;
  try {
    provider = await resolveAiCall("chat", userId);
  } catch (e) {
    if (e instanceof MissingAiRoleError) {
      return Response.json(
        { error: e.message, code: "MISSING_AI_ROLE" },
        { status: 412 },
      );
    }
    throw e;
  }
  timer.mark("resolveProvider");

  try {
    if (provider.kind === "claude-code-daemon") {
      const messages = sanitizeMessages(
        await normalizeMessages(parsed.data.messages)
      );
      const sourceScope = parsed.data.sourceScope ?? "all";
      const { taskId } = await enqueueChatTask({
        userId,
        messages,
        sourceScope,
        modelId: provider.modelId,
      });
      if (!isAuthBypassEnabled()) {
        void recordAiUsage(userId).catch(() => undefined);
      }
      timer.mark("enqueue");
      timer.end({ mode: "daemon" });
      return Response.json({ taskId, mode: "daemon" });
    }

    if (provider.kind === "transformers") {
      return Response.json(
        { error: "Transformers kind cannot serve chat. Reassign chat role in Settings." },
        { status: 412 }
      );
    }

    const { system, messages } = await buildChatContext(parsed.data, userId);
    timer.mark("buildContext");

    const supportsTools =
      provider.kind === "openai-compatible" || provider.kind === "local";

    let tools: ReturnType<typeof buildAskAiTools> | undefined;
    let toolSystemPreamble = "";
    if (supportsTools) {
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
        `Do not exceed ${maxStepsForKind(provider.kind)} steps. Stop calling tools ` +
        `as soon as you can answer.`;
    }

    const { response: rawResponse, modelId, kind } = await streamChatResponse(
      {
        messages,
        sessionId: parsed.data.id,
        signal: req.signal,
        system: system + toolSystemPreamble,
        tools,
        maxSteps: tools ? maxStepsForKind(provider.kind) : undefined,
      },
      { userId, role: "chat" },
    );
    timer.mark("streamReady");
    timer.end({ mode: tools ? "stream-tools" : "stream" });

    if (!isAuthBypassEnabled()) {
      void recordAiUsage(userId).catch(() => undefined);
    }

    const finalResponse = supportsTools
      ? rawResponse
      : adaptTextStreamToUiMessageStream(rawResponse);

    return withDebugHeaders(finalResponse, { kind, modelId });
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
