import { spawn as cpSpawn } from "node:child_process";

let claudeBin = "claude";

export function setClaudeBin(bin) {
  claudeBin = bin;
}

/**
 * Chat mode: streams text deltas via onText callback, returns final text.
 */
export function spawnClaudeForChat({ prompt, systemPrompt, model, onText }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--system-prompt", systemPrompt,
      "--tools", "",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    if (model) args.push("--model", model);

    const child = cpSpawn(claudeBin, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks = [];
    let finalResult = "";
    let lineBuf = "";

    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "stream_event" && event.event) {
            const se = event.event;
            if (
              se.type === "content_block_delta" &&
              se.delta?.type === "text_delta" &&
              typeof se.delta.text === "string"
            ) {
              onText(se.delta.text);
            }
            continue;
          }
          if (event.type === "result" && typeof event.result === "string") {
            finalResult = event.result;
          }
        } catch {
          // skip
        }
      }
    });

    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve(finalResult);
    });
  });
}

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
