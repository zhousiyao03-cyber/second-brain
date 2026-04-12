import { completeTask } from "./api.mjs";
import { spawnClaudeForStructured } from "./spawn-claude.mjs";

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function handleStructuredTask(task) {
  console.log(`[${ts()}] 📦 structured: ${task.id} (${task.model})`);

  try {
    const rawText = await spawnClaudeForStructured({
      prompt: task.systemPrompt,
      model: task.model,
    });

    // Extract JSON from possible markdown fences
    const trimmed = rawText.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    const jsonText = (start !== -1 && end > start)
      ? candidate.slice(start, end + 1)
      : candidate;

    JSON.parse(jsonText); // validate

    await completeTask(task.id, { structuredResult: jsonText });
    console.log(`[${ts()}] ✅ structured done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ structured failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
