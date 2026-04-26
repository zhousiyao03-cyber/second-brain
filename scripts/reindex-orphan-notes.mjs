/**
 * Enqueue index jobs for notes that have content but no chunks.
 *
 * Notes can end up in this state if they were created by a path that
 * skipped the normal enqueue (legacy import, migration, manual SQL).
 * The cron worker drains pending index jobs every minute, so once
 * enqueued the chunks (and embeddings, subject to Gemini rate limits)
 * will appear within ~5 minutes.
 *
 * Idempotent — safe to re-run; only inserts jobs for notes that still
 * lack chunks at query time.
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  readFileSync("D:/repos/knosi/.env.turso-prod.local", "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
    })
);
const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node scripts/reindex-orphan-notes.mjs <userId>");
  process.exit(1);
}

const orphans = await client.execute({
  sql: `SELECT n.id, n.title, length(n.plain_text) as plain_len
        FROM notes n
        WHERE n.user_id = ?
          AND length(coalesce(n.plain_text, '')) > 20
          AND NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.source_id = n.id)
        ORDER BY n.updated_at DESC`,
  args: [userId],
});

console.log(`Found ${orphans.rows.length} notes with content but no chunks. Enqueueing...`);

let enqueued = 0;
let skipped = 0;
for (const row of orphans.rows) {
  // Skip if a pending job already exists for this note
  const existing = await client.execute({
    sql: `SELECT id FROM knowledge_index_jobs
          WHERE source_type = 'note' AND source_id = ?
            AND status IN ('pending','running') LIMIT 1`,
    args: [row.id],
  });
  if (existing.rows.length > 0) {
    skipped++;
    continue;
  }
  await client.execute({
    sql: `INSERT INTO knowledge_index_jobs (id, source_type, source_id, reason, status, attempts, queued_at)
          VALUES (?, 'note', ?, 'orphan-reindex', 'pending', 0, strftime('%s','now'))`,
    args: [crypto.randomUUID(), row.id],
  });
  console.log(`  enqueued ${row.id.slice(0, 8)} "${(row.title || "").slice(0, 50)}" (plain=${row.plain_len})`);
  enqueued++;
}

console.log(`\nEnqueued: ${enqueued}  Skipped (already pending): ${skipped}`);
console.log("Cron worker will drain these at 10/min. Watch progress with check-recent-notes-status.mjs.");
