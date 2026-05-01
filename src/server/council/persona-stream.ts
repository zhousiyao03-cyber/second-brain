import {
  streamPlainTextAiSdk,
  type AiSdkMode,
} from "@/server/ai/provider";
import { getProviderMode } from "@/server/ai/provider/mode";
import type { Persona } from "./types";
import {
  searchKnowledgeForPersona,
  type PersonaRagHit,
} from "./persona-rag";
import type { HistoryEntry } from "./classifier";

const HISTORY_WINDOW = 20;
const RAG_CHUNK_PREVIEW = 400;

/**
 * Stream one persona's response as a plain-text async iterable.
 *
 * RAG: queries against the persona's scope using the most recent user
 * message as the query. Falls back to "answer from general knowledge" if
 * scope yields no hits.
 *
 * Provider routing: this path goes through the AI SDK directly. If the
 * user has set claude-code-daemon mode, council falls back to the AI SDK
 * default (per spec phase-1 limitation).
 */
export async function* streamPersonaResponse({
  persona,
  history,
  userId,
  channelTopic,
  abortSignal,
}: {
  persona: Persona;
  history: HistoryEntry[];
  userId: string;
  channelTopic: string | null;
  abortSignal: AbortSignal;
}): AsyncIterable<string> {
  const lastUser = [...history].reverse().find((e) => e.role === "user");
  const query = lastUser?.content ?? history.at(-1)?.content ?? "";

  const ragHits =
    query.length > 0
      ? await searchKnowledgeForPersona({ persona, query, userId })
      : [];

  const { system, user } = buildPersonaPrompt({
    persona,
    history,
    ragHits,
    channelTopic,
  });

  const mode = await resolveCouncilMode(userId);

  const stream = await streamPlainTextAiSdk(
    {
      system,
      messages: [{ role: "user", content: user }],
      signal: abortSignal,
      mode,
    },
    { userId },
  );

  for await (const chunk of stream) {
    if (abortSignal.aborted) return;
    yield chunk;
  }
}

/**
 * Council Phase 1 only supports AI-SDK-backed providers (openai/local).
 * If the user has chosen codex or claude-code-daemon, we fall back to
 * "openai" if that env is configured, else "local".
 */
async function resolveCouncilMode(userId: string): Promise<AiSdkMode> {
  const mode = await getProviderMode({ userId });
  if (mode === "openai" || mode === "local") return mode;
  // Fallback selection
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "local";
}

function buildPersonaPrompt({
  persona,
  history,
  ragHits,
  channelTopic,
}: {
  persona: Persona;
  history: HistoryEntry[];
  ragHits: PersonaRagHit[];
  channelTopic: string | null;
}): { system: string; user: string } {
  const styleLine = persona.styleHint
    ? `\nStyle hint: ${persona.styleHint}`
    : "";

  const knowledge =
    ragHits.length === 0
      ? "(no scoped knowledge available — answer from your general knowledge)"
      : ragHits
          .map(
            (h, i) =>
              `[${i + 1}] Source: ${h.sourceType} "${h.sourceTitle}"\n> ${h.content.slice(0, RAG_CHUNK_PREVIEW)}`,
          )
          .join("\n\n");

  const conversation = history
    .slice(-HISTORY_WINDOW)
    .map((e) => {
      const speaker = e.personaName ?? (e.role === "user" ? "用户" : e.role);
      return `[${speaker}]: ${e.content}`;
    })
    .join("\n");

  const system = `${persona.systemPrompt}${styleLine}

Channel topic: ${channelTopic ?? "(none)"}

Knowledge from your scope:
${knowledge}

Speak as ${persona.name}. Be concise (2-4 sentences typical, never exceed 6).
Cite sources by [note: title] when you reference them. You can disagree with what
others said. Do NOT repeat what was already said. Do NOT introduce yourself.`;

  const user = `Conversation so far:
${conversation}

Now respond.`;

  return { system, user };
}
