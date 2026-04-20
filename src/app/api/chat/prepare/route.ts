import type { ModelMessage } from "ai";
import { buildChatContext, chatInputSchema } from "@/server/ai/chat-prepare";
import { auth } from "@/lib/auth";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
import { getEntitlements } from "@/server/billing/entitlements";
import { getAIErrorMessage } from "@/server/ai/provider";

export const maxDuration = 30;

export interface PreparedChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PreparedChatBundle {
  system: string;
  messages: PreparedChatMessage[];
}

function flattenContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function toPreparedMessages(messages: ModelMessage[]): PreparedChatMessage[] {
  const prepared: PreparedChatMessage[] = [];
  for (const message of messages) {
    if (
      message.role !== "user" &&
      message.role !== "assistant" &&
      message.role !== "system"
    ) {
      continue;
    }
    const text = flattenContent(message.content).trim();
    if (!text) continue;
    prepared.push({ role: message.role, content: text });
  }
  return prepared;
}

export async function POST(req: Request) {
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
    const { system, messages } = await buildChatContext(parsed.data, userId);

    if (process.env.AUTH_BYPASS !== "true" && userId) {
      void recordAiUsage(userId).catch(() => undefined);
    }

    const bundle: PreparedChatBundle = {
      system,
      messages: toPreparedMessages(messages),
    };
    return Response.json(bundle);
  } catch (error) {
    const isInvalidInput =
      error instanceof Error &&
      error.message.includes("Invalid chat message format");

    return Response.json(
      {
        error: getAIErrorMessage(
          error,
          isInvalidInput ? "Invalid input" : "AI chat prepare failed"
        ),
      },
      { status: isInvalidInput ? 400 : 500 }
    );
  }
}
