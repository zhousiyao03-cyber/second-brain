import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod/v4";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, eq } from "drizzle-orm";
import { runTurn } from "@/server/council/orchestrator";
import type { SSEEvent } from "@/server/council/types";

export const runtime = "nodejs"; // RAG path uses native deps

const encoder = new TextEncoder();

const bodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  messageId: z.string().uuid().optional(),
});

function encodeSseEvent(evt: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(evt)}\n\n`);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  // Auth (with E2E bypass support via getRequestSession)
  const session = await getRequestSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { channelId } = await params;

  // Ownership check
  const [channel] = await db
    .select()
    .from(councilChannels)
    .where(
      and(eq(councilChannels.id, channelId), eq(councilChannels.userId, userId)),
    )
    .limit(1);
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load personas in this channel
  const personaRows = await db
    .select({ persona: councilPersonas })
    .from(councilChannelPersonas)
    .innerJoin(
      councilPersonas,
      eq(councilChannelPersonas.personaId, councilPersonas.id),
    )
    .where(eq(councilChannelPersonas.channelId, channelId));

  if (personaRows.length === 0) {
    return NextResponse.json(
      { error: "No personas in channel" },
      { status: 400 },
    );
  }

  // Parse body
  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { content } = parsed.data;
  const userMessageId = parsed.data.messageId ?? crypto.randomUUID();

  // SSE stream
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of runTurn({
          channel,
          personas: personaRows.map((r) => r.persona),
          userMessage: { id: userMessageId, content },
          userId,
          abortSignal: req.signal,
        })) {
          controller.enqueue(encodeSseEvent(evt));
        }
      } catch (err) {
        if (!isAbortError(err)) {
          controller.enqueue(
            encodeSseEvent({
              type: "error",
              message: (err as Error).message ?? "unknown",
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
