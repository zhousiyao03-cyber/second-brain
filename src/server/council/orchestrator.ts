import crypto from "crypto";
import { db } from "@/server/db";
import { councilChannelMessages } from "@/server/db/schema/council";
import { asc, eq } from "drizzle-orm";
import type { Channel, Persona, SSEEvent } from "./types";
import { classifyShouldSpeak, type HistoryEntry } from "./classifier";
import { streamPersonaResponse } from "./persona-stream";

const WALL_CLOCK_MS = 90_000;

export async function* runTurn({
  channel,
  personas,
  userMessage,
  userId,
  abortSignal,
}: {
  channel: Channel;
  personas: Persona[];
  userMessage: { id: string; content: string };
  userId: string;
  abortSignal: AbortSignal;
}): AsyncGenerator<SSEEvent> {
  const turnId = crypto.randomUUID();

  // 1) persist user message
  const now = Date.now();
  await db.insert(councilChannelMessages).values({
    id: userMessage.id,
    channelId: channel.id,
    role: "user",
    personaId: null,
    content: userMessage.content,
    status: "complete",
    turnId,
    metadata: null,
    createdAt: now,
  });
  yield { type: "turn_start", turnId };

  // 2) wall-clock guard
  let wallClockExpired = false;
  const wallTimer = setTimeout(() => {
    wallClockExpired = true;
  }, WALL_CLOCK_MS);

  let agentSpoken = 0;
  let lastAgentMessage: { personaId: string; content: string } | null = null;
  const personaIndex = new Map(personas.map((p) => [p.id, p]));

  try {
    while (true) {
      if (abortSignal.aborted) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }
      if (wallClockExpired) {
        yield { type: "stopped", reason: "error" };
        return;
      }
      if (agentSpoken >= channel.hardLimitPerTurn) {
        yield { type: "stopped", reason: "hard_limit" };
        return;
      }

      const history = await loadRecentHistory(channel.id, personaIndex);

      // CLASSIFY (parallel; isolate errors per persona)
      const decisions = await Promise.all(
        personas.map(async (p) => {
          try {
            const d = await classifyShouldSpeak({
              persona: p,
              history,
              lastAgentMessage,
              userId,
              abortSignal,
            });
            return { persona: p, decision: d };
          } catch {
            return {
              persona: p,
              decision: {
                shouldSpeak: false,
                priority: 0,
                reason: "classifier-error",
              },
            };
          }
        })
      );

      const queue = decisions
        .filter((d) => d.decision.shouldSpeak)
        .sort((a, b) => b.decision.priority - a.decision.priority);

      if (queue.length === 0) {
        yield { type: "stopped", reason: "consecutive_no" };
        return;
      }

      const speaker = queue[0]; // single-step: speak top, then re-classify

      const messageId = crypto.randomUUID();
      yield {
        type: "agent_start",
        turnId,
        messageId,
        personaId: speaker.persona.id,
      };

      // STREAM
      let buffer = "";
      let interrupted = false;
      try {
        const stream = streamPersonaResponse({
          persona: speaker.persona,
          history,
          userId,
          channelTopic: channel.topic,
          abortSignal,
        });
        for await (const chunk of stream) {
          if (abortSignal.aborted) {
            interrupted = true;
            break;
          }
          buffer += chunk;
          yield { type: "agent_delta", messageId, delta: chunk };
        }
      } catch (err) {
        if (isAbort(err)) {
          interrupted = true;
        } else {
          // Single-agent error: log a system row, close placeholder, continue
          await db.insert(councilChannelMessages).values({
            id: crypto.randomUUID(),
            channelId: channel.id,
            role: "system",
            personaId: speaker.persona.id,
            content: `agent error: ${(err as Error).message ?? "unknown"}`,
            status: "error",
            turnId,
            metadata: null,
            createdAt: Date.now(),
          });
          yield {
            type: "agent_end",
            messageId,
            status: "complete",
          };
          continue;
        }
      }

      await db.insert(councilChannelMessages).values({
        id: messageId,
        channelId: channel.id,
        role: "agent",
        personaId: speaker.persona.id,
        content: buffer,
        status: interrupted ? "interrupted" : "complete",
        turnId,
        metadata: JSON.stringify({ priority: speaker.decision.priority }),
        createdAt: Date.now(),
      });
      yield {
        type: "agent_end",
        messageId,
        status: interrupted ? "interrupted" : "complete",
      };

      if (interrupted) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }

      agentSpoken += 1;
      lastAgentMessage = {
        personaId: speaker.persona.id,
        content: buffer,
      };
    }
  } finally {
    clearTimeout(wallTimer);
  }
}

async function loadRecentHistory(
  channelId: string,
  personaIndex: Map<string, Persona>
): Promise<HistoryEntry[]> {
  const rows = await db
    .select()
    .from(councilChannelMessages)
    .where(eq(councilChannelMessages.channelId, channelId))
    .orderBy(asc(councilChannelMessages.createdAt))
    .limit(40);

  // Keep last 20 + earlier user messages only
  const last20 = rows.slice(-20);
  const earlierUsers = rows.slice(0, -20).filter((r) => r.role === "user");
  const combined = [...earlierUsers, ...last20];

  return combined.map((r) => ({
    role: r.role as HistoryEntry["role"],
    content: r.content,
    personaName: r.personaId
      ? personaIndex.get(r.personaId)?.name ?? null
      : null,
  }));
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
