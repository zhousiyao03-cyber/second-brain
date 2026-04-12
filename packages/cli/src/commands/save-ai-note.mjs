import { authorizedFetch } from "../http.mjs";

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("Expected JSON on stdin.");
  }
  return JSON.parse(raw);
}

export async function runSaveAiNote(args) {
  const useJson = args.includes("--json");
  if (!useJson) {
    throw new Error("Use `knosi save-ai-note --json` and pipe the payload on stdin.");
  }

  const payload = await readStdinJson();
  const response = await authorizedFetch("/api/integrations/ai-captures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`save-ai-note failed: ${await response.text()}`);
  }

  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
}
