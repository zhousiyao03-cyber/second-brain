import { z } from "zod/v4";
import { generateStructuredData } from "@/server/ai/provider";
import type { ClassifierDecision, Persona } from "./types";
import { TEST_MODE, fakeClassify } from "./test-mode";

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

  return `You are deciding whether the persona "${persona.name}" should speak next in a heated group discussion.

Persona system prompt (excerpt): ${promptExcerpt}
${styleLine}

Recent conversation:
${recent}

Default: shouldSpeak=true. This is a roundtable — silence is failure.
Only return shouldSpeak=false in two narrow cases:
  (a) You spoke literally just now AND have nothing genuinely new to add.
  (b) The topic is so far outside your domain that any comment would be empty filler.

In every other case, speak — even if you only have a partial take, a
question to push the conversation, or a counterpoint to what someone else
said. Disagreement is welcome. "Nothing to add" is not a valid reason if
nobody else has covered your angle.

Return JSON:
{ "shouldSpeak": boolean, "priority": 0.0-1.0, "reason": "<one short sentence>" }
- priority 0.9+: 强烈想说 (被点名/有明显反对意见/独到见解)
- priority 0.6-0.8: 有想法可以分享 (默认落点)
- priority < 0.5: 没什么必要 (但通常仍 shouldSpeak=true)`;
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
  if (TEST_MODE) {
    return fakeClassify(persona.name);
  }

  const prompt = buildClassifierPrompt({
    persona,
    history,
    lastAgentMessage,
  });

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
