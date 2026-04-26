import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
    })
  );
}

const env = loadEnv("D:/repos/knosi/.env.turso-prod.local");
const NOTE_ID = process.argv[2] || "5cf9e533-8ff9-4267-a170-308f0f7e0cef";

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const result = await client.execute({
  sql: "SELECT id, title, content, plain_text, folder_id, created_at FROM notes WHERE id = ?",
  args: [NOTE_ID],
});

console.log("rows:", result.rows.length);
for (const row of result.rows) {
  console.log("\n--- Note", row.id, "---");
  console.log("title:", row.title);
  console.log("folder_id:", row.folder_id);
  console.log("created_at:", row.created_at);
  console.log("content_len:", row.content?.length ?? 0);
  console.log("plain_len:", row.plain_text?.length ?? 0);
  console.log("\nFULL content:");
  try {
    console.log(JSON.stringify(JSON.parse(row.content), null, 2));
  } catch {
    console.log(row.content);
  }
  console.log("\nFULL plain_text:");
  console.log(row.plain_text);
}

client.close();
