// One-off: read the user's last 60 days of chat_tasks from Turso prod,
// extract the *first* user-typed query out of each (the part before any
// "<knowledge_base>" RAG preamble), de-dupe, and dump a sorted list with
// timestamps. Output is consumed by the human/me to pick ground-truth queries.
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync("/Users/bytedance/knosi/.env.turso-prod.local", "utf8");
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const token = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();
const c = createClient({ url, authToken: token });

const USER_ID = "5dcad5a2-1d20-43df-818c-d640958ddb8a";

const r = await c.execute({
  sql: `SELECT id, source_scope, messages, created_at
        FROM chat_tasks
        WHERE user_id = ? AND task_type = 'chat'
        ORDER BY created_at DESC`,
  args: [USER_ID],
});

const seen = new Map(); // normalized query → { ts, count, scope, raw }

for (const row of r.rows) {
  let messages;
  try {
    messages = JSON.parse(row.messages);
  } catch {
    continue;
  }
  // Find the FIRST user message — that's the original query (subsequent user
  // messages are usually follow-ups in the same conversation).
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) continue;
  const text =
    typeof firstUser.content === "string"
      ? firstUser.content
      : firstUser.content?.find?.((p) => p.type === "text")?.text ?? "";
  if (!text) continue;

  // Strip the RAG preamble — Knosi prepends "当前检索了..." + <knowledge_base>...</knowledge_base>
  // before the user's actual question. The real question is at the end.
  let q = text;
  // Pattern: text ends with the actual user query after </knowledge_base>...
  // Looking at samples: "当前检索了...\n\n<knowledge_base>...</knowledge_base>\n\n<user_question>QUERY</user_question>"
  const userQuestionMatch = q.match(/<user_question>([\s\S]*?)<\/user_question>/);
  if (userQuestionMatch) {
    q = userQuestionMatch[1].trim();
  } else if (q.includes("<knowledge_base>")) {
    // Fallback: take everything after the closing </knowledge_base> tag
    const after = q.split(/<\/knowledge_base>/i).pop();
    if (after) q = after.trim();
  }
  // Normalize: trim, collapse whitespace
  q = q.replace(/\s+/g, " ").trim();
  if (!q || q.length > 800) continue; // skip empty or huge

  const key = q.toLowerCase();
  const prev = seen.get(key);
  if (prev) {
    prev.count += 1;
    if (row.created_at > prev.ts) prev.ts = row.created_at;
  } else {
    seen.set(key, {
      query: q,
      ts: Number(row.created_at),
      count: 1,
      scope: row.source_scope,
    });
  }
}

const queries = [...seen.values()].sort((a, b) => b.ts - a.ts);

const out = queries.map((x) => ({
  query: x.query,
  date: new Date(x.ts * 1000).toISOString().slice(0, 10),
  count: x.count,
  scope: x.scope,
}));

writeFileSync("/tmp/real-queries.json", JSON.stringify(out, null, 2));
console.log(`Extracted ${out.length} unique queries`);
console.log(`Date range: ${out[out.length-1]?.date} → ${out[0]?.date}`);
console.log("\nTop 30 most recent:");
for (const x of out.slice(0, 30)) {
  console.log(`  [${x.date}] (×${x.count}, scope=${x.scope})  ${x.query.slice(0, 100)}`);
}
