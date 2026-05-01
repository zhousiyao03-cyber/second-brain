import { z } from "zod/v4";
import { generateStructuredData } from "@/server/ai/provider";
import type { ClassifierDecision, Persona } from "./types";

const ClassifierSchema = z.object({
  shouldSpeak: z.boolean(),
  priority: z.number().min(0).max(1),
  reason: z.string().max(200),
});

export type HistoryEntry = {
  role: "user" | "agent" | "system";
  content: string;
  personaName: string | null;
};

export function buildClassifierPrompt({
  persona,
  history,
}: {
  persona: Persona;
  history: HistoryEntry[];
  lastAgentMessage?: { personaId: string; content: string } | null;
}): string {
  const recent = history
    .slice(-8)
    .map((e) => {
      const speaker = e.personaName ?? (e.role === "user" ? "用户" : e.role);
      return `[${speaker}]: ${e.content}`;
    })
    .join("\n");

  const promptExcerpt = persona.systemPrompt.slice(0, 200);
  const styleLine = persona.styleHint ? `Style hint: ${persona.styleHint}` : "";

  return `You are deciding whether the persona "${persona.name}" should speak next in a group discussion.

Persona system prompt (excerpt): ${promptExcerpt}
${styleLine}

Recent conversation:
${recent}

Rules:
1. Speak if you have something genuinely useful, contrarian, or clarifying to say.
2. Don't speak just to agree. Don't repeat what others already said.
3. If the last speaker was you and no new info appeared, do NOT speak again.
4. If the topic clearly isn't your domain, do NOT speak.

Return JSON:
{ "shouldSpeak": boolean, "priority": 0.0-1.0, "reason": "<one short sentence>" }
- priority 0.9+: 强烈想说 (被点名/明显错误要纠正/独到见解)
- priority 0.5-0.8: 有想法可以分享
- priority < 0.5: 勉强想说 (一般 false 更好)`;
}

export async function classifyShouldSpeak({
  persona,
  history,
  lastAgentMessage,
  userId,
  abortSignal,
}: {
  persona: Persona;
  history: HistoryEntry[];
  lastAgentMessage?: { personaId: string; content: string } | null;
  userId: string;
  abortSignal?: AbortSignal;
}): Promise<ClassifierDecision> {
  const prompt = buildClassifierPrompt({ persona, history, lastAgentMessage });

  try {
    const result = await generateStructuredData(
      {
        description: "Decide whether a persona should speak in a multi-agent discussion turn.",
        name: "shouldSpeakDecision",
        prompt,
        schema: ClassifierSchema,
        signal: abortSignal,
      },
      { userId },
    );
    return {
      shouldSpeak: result.shouldSpeak,
      priority: result.priority,
      reason: result.reason,
    };
  } catch (err) {
    if (isAbort(err)) throw err;
    console.warn("[council] classifier failed", err);
    return { shouldSpeak: false, priority: 0, reason: "classifier-error" };
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
