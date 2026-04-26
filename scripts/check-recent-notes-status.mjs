import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("D:/repos/knosi/.env.turso-prod.local","utf8").split("\n").filter(Boolean).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)];})
);
const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const userId = "5dcad5a2-1d20-43df-818c-d640958ddb8a";

// Notes from past 30 days, with chunk + embedding counts
const r = await client.execute({
  sql: `SELECT n.id, n.title, n.updated_at,
               (SELECT count(*) FROM knowledge_chunks c WHERE c.source_id = n.id AND c.user_id = n.user_id) as chunks,
               (SELECT count(*) FROM knowledge_chunks c
                JOIN knowledge_chunk_embeddings e ON e.chunk_id = c.id
                WHERE c.source_id = n.id AND c.user_id = n.user_id) as embedded
        FROM notes n
        WHERE n.user_id = ?
          AND n.updated_at > strftime('%s', 'now', '-30 days')
        ORDER BY n.updated_at DESC`,
  args: [userId],
});

console.log(`Past 30 days: ${r.rows.length} notes\n`);
console.log(`${"Date".padEnd(20)} ${"Chunks".padStart(7)} ${"Emb".padStart(5)} Status   Title`);
console.log("─".repeat(110));

let fullyEmbedded = 0;
let partiallyEmbedded = 0;
let notEmbedded = 0;
let noChunks = 0;

for (const n of r.rows) {
  const date = n.updated_at ? new Date(Number(n.updated_at) * 1000).toLocaleString("en-GB", {hour12:false}).slice(0,17) : "?";
  const chunks = Number(n.chunks);
  const embedded = Number(n.embedded);
  let status;
  if (chunks === 0) { status = "NOCHUNK"; noChunks++; }
  else if (embedded === 0) { status = "NOEMBED"; notEmbedded++; }
  else if (embedded < chunks) { status = "PARTIAL"; partiallyEmbedded++; }
  else { status = "OK     "; fullyEmbedded++; }
  console.log(`${date.padEnd(20)} ${String(chunks).padStart(7)} ${String(embedded).padStart(5)} ${status} ${(n.title || "").slice(0, 60)}`);
}

console.log("─".repeat(110));
console.log(`OK=${fullyEmbedded}  PARTIAL=${partiallyEmbedded}  NOEMBED=${notEmbedded}  NOCHUNK=${noChunks}`);
