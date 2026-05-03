import crypto from "crypto";
import { db } from "@/server/db";
import { councilChannelMessages } from "@/server/db/schema/council";
import { asc, eq } from "drizzle-orm";
import type { Channel, ClassifierDecision, Persona, SSEEvent } from "./types";
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
  // NOTE: wallClockExpired is only checked between iterations, not
  // mid-stream. A stalled streamPersonaResponse will not be killed
  // by this guard alone — Phase 2 should wire the timer through an
  // internal AbortController so the underlying stream gets cancelled.
  let wallClockExpired = false;
  const wallTimer = setTimeout(() => {
    wallClockExpired = true;
  }, WALL_CLOCK_MS);

  let agentSpoken = 0;
  let lastAgentMessage: { personaId: string; content: string } | null = null;
  const personaIndex = new Map(personas.map((p) => [p.id, p]));

  /**
   * Stream one persona's response, persist the resulting agent (or error) row,
   * and yield the matching agent_start / agent_delta / agent_end SSE events.
   * Returns whether the stream was interrupted by the client.
   */
  async function* runOneSpeaker(speaker: {
    persona: Persona;
    decision: ClassifierDecision;
  }, history: HistoryEntry[]): AsyncGenerator<SSEEvent, { interrupted: boolean; buffer: string }> {
    const messageId = crypto.randomUUID();
    yield {
      type: "agent_start",
      turnId,
      messageId,
      personaId: speaker.persona.id,
    };

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
        // Persist a system error row under the SAME messageId so the SSE
        // agent_end and the DB row reference the same identifier. Caller
        // skips counting agentSpoken so other personas can still try.
        await db.insert(councilChannelMessages).values({
          id: messageId,
          channelId: channel.id,
          role: "system",
          personaId: speaker.persona.id,
          content: `agent error: ${(err as Error).message ?? "unknown"}`,
          status: "error",
          turnId,
          metadata: null,
          createdAt: Date.now(),
        });
        yield { type: "agent_end", messageId, status: "interrupted" };
        return { interrupted: false, buffer: "" };
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
    return { interrupted, buffer };
  }

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

      // CLASSIFY (parallel; isolate per-persona errors but propagate abort)
      let decisions: Array<{ persona: Persona; decision: ClassifierDecision }>;
      try {
        decisions = await Promise.all(
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
            } catch (err) {
              // If abort happened, propagate up so the outer abort branch
              // emits user_interrupt instead of consecutive_no.
              if (abortSignal.aborted || isAbort(err)) throw err;
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
      } catch (err) {
        if (abortSignal.aborted || isAbort(err)) {
          yield { type: "stopped", reason: "user_interrupt" };
          return;
        }
        throw err;
      }

      if (abortSignal.aborted) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }

      const queue = decisions
        .filter((d) => d.decision.shouldSpeak)
        .sort((a, b) => b.decision.priority - a.decision.priority);

      if (queue.length === 0) {
        yield { type: "stopped", reason: "consecutive_no" };
        return;
      }

      // First-turn fan-out: when nobody has spoken yet this turn (i.e. the
      // user just sent a message), let EVERY persona who wants to speak
      // respond — sequentially, in priority order — to seed a real
      // multi-perspective discussion. Subsequent rounds revert to single-
      // step (speak top, re-classify) so debate stays focused and the hard
      // limit isn't blown in one user message.
      const turnSpeakers =
        agentSpoken === 0
          ? queue.slice(0, channel.hardLimitPerTurn - agentSpoken)
          : [queue[0]];

      let interruptedThisRound = false;
      for (const speaker of turnSpeakers) {
        if (agentSpoken >= channel.hardLimitPerTurn) break;
        if (abortSignal.aborted) {
          interruptedThisRound = true;
          break;
        }

        // Reload history before each speaker so a persona sees what its
        // peers JUST said this turn — this is what makes them disagree
        // instead of independently riff on the user message.
        const freshHistory =
          turnSpeakers.length === 1
            ? history
            : await loadRecentHistory(channel.id, personaIndex);

        const result = yield* runOneSpeaker(speaker, freshHistory);

        if (result.interrupted) {
          interruptedThisRound = true;
          break;
        }
        if (result.buffer.length === 0) {
          // Error row was already persisted; do not count toward agentSpoken
          // so peers still get a turn this round.
          continue;
        }

        agentSpoken += 1;
        lastAgentMessage = {
          personaId: speaker.persona.id,
          content: result.buffer,
        };
      }

      if (interruptedThisRound) {
        yield { type: "stopped", reason: "user_interrupt" };
        return;
      }
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
