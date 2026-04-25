import { spawn as cpSpawn } from "node:child_process";

let claudeBin = "claude";

export function setClaudeBin(bin) {
  claudeBin = bin;
}

// Chat mode now lives in chat-worker.mjs (persistent stream-json subprocess
// pool keyed on conversationKey + --resume for session continuity). The
// previous one-shot `claude -p prompt --tools ""` chat path was removed
// 2026-04-25 — see docs/superpowers/specs/2026-04-25-daemon-persistent-worker-design.md.

/**
 * Structured mode: non-streaming, returns full text result.
 */
export function spawnClaudeForStructured({ prompt, model }) {
  return new Promise((resolve, reject) => {
    const systemPrompt =
      "You are a structured data generator. Always return exactly one JSON object with no markdown fences or extra prose.";

    const args = [
      "-p", prompt,
      "--system-prompt", systemPrompt,
      "--tools", "",
      "--output-format", "json",
      "--verbose",
    ];
    if (model) args.push("--model", model);

    const child = cpSpawn(claudeBin, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderrChunks = [];
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(typeof parsed.result === "string" ? parsed.result : stdout);
      } catch {
        resolve(stdout);
      }
    });
  });
}
