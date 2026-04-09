#!/usr/bin/env node
/**
 * One-shot Turso rollout: add user_id to knowledge_chunks + backfill.
 *
 * Usage:
 *   # Local libsql file:
 *   node scripts/db/apply-2026-04-09-knowledge-chunks-user-id.mjs
 *   # Production Turso:
 *   set -a && source .env.turso-prod.local && set +a \
 *     && node scripts/db/apply-2026-04-09-knowledge-chunks-user-id.mjs
 *
 * What it does:
 *   1. ALTER TABLE knowledge_chunks ADD COLUMN user_id TEXT REFERENCES users(id)
 *      (skipped if column already exists)
 *   2. CREATE INDEX knowledge_chunks_user_id_idx IF NOT EXISTS
 *   3. Backfill: for every chunk whose user_id IS NULL, copy it from the
 *      owning note / bookmark based on source_type + source_id.
 *   4. Verify: counts before/after, plus sample row.
 *
 * Exits non-zero on any failure. Idempotent — safe to re-run.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");

function loadEnvIfPresent(path) {
  try {
    const content = readFileSync(path, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // file not present — ignore
  }
}

// Allow either explicit prod env (.env.turso-prod.local already sourced)
// or fall back to .env.local for dev runs pointing at libsql file.
loadEnvIfPresent(join(repoRoot, ".env.local"));

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error(
    "Missing TURSO_DATABASE_URL. Source .env.turso-prod.local for prod, or set it in .env.local for a local libsql file."
  );
  process.exit(1);
}

const client = createClient({ url, authToken });

console.log(`Target: ${url}`);
console.log("");

// ── Step 1: schema ────────────────────────────────────────────────────────
async function columnExists(table, column) {
  const info = await client.execute({
    sql: `PRAGMA table_info(${table})`,
    args: [],
  });
  return info.rows.some((row) => row.name === column);
}

async function indexExists(name) {
  const res = await client.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

console.log("Step 1: schema");

if (await columnExists("knowledge_chunks", "user_id")) {
  console.log("  · user_id column already exists — skip");
} else {
  await client.execute(
    `ALTER TABLE knowledge_chunks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE`
  );
  console.log("  · user_id column added");
}

if (await indexExists("knowledge_chunks_user_id_idx")) {
  console.log("  · knowledge_chunks_user_id_idx already exists — skip");
} else {
  await client.execute(
    `CREATE INDEX knowledge_chunks_user_id_idx ON knowledge_chunks(user_id)`
  );
  console.log("  · knowledge_chunks_user_id_idx created");
}

// ── Step 2: backfill ──────────────────────────────────────────────────────
console.log("");
console.log("Step 2: backfill");

const beforeCounts = await client.execute({
  sql: `SELECT
          SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS null_count,
          SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS filled_count,
          COUNT(*) AS total
        FROM knowledge_chunks`,
  args: [],
});
console.log(
  `  · before: total=${beforeCounts.rows[0].total}, null=${beforeCounts.rows[0].null_count}, filled=${beforeCounts.rows[0].filled_count}`
);

// Backfill from notes
const noteBackfill = await client.execute({
  sql: `UPDATE knowledge_chunks
        SET user_id = (
          SELECT notes.user_id FROM notes WHERE notes.id = knowledge_chunks.source_id
        )
        WHERE user_id IS NULL AND source_type = 'note'`,
  args: [],
});
console.log(`  · notes backfilled: ${noteBackfill.rowsAffected ?? "?"} rows`);

// Backfill from bookmarks
const bookmarkBackfill = await client.execute({
  sql: `UPDATE knowledge_chunks
        SET user_id = (
          SELECT bookmarks.user_id FROM bookmarks WHERE bookmarks.id = knowledge_chunks.source_id
        )
        WHERE user_id IS NULL AND source_type = 'bookmark'`,
  args: [],
});
console.log(
  `  · bookmarks backfilled: ${bookmarkBackfill.rowsAffected ?? "?"} rows`
);

// Chunks whose owning row is gone: orphans — we delete them. Without a
// user they cannot be retrieved safely anyway.
const orphanCount = await client.execute({
  sql: `SELECT COUNT(*) AS c FROM knowledge_chunks WHERE user_id IS NULL`,
  args: [],
});
const orphans = Number(orphanCount.rows[0].c ?? 0);
if (orphans > 0) {
  console.log(`  · ${orphans} orphan chunks (owning source missing) — deleting`);
  // Delete embeddings first to honor FK, then chunks.
  await client.execute({
    sql: `DELETE FROM knowledge_chunk_embeddings
          WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE user_id IS NULL)`,
    args: [],
  });
  await client.execute({
    sql: `DELETE FROM knowledge_chunks WHERE user_id IS NULL`,
    args: [],
  });
}

// ── Step 3: verify ────────────────────────────────────────────────────────
console.log("");
console.log("Step 3: verify");

const afterCounts = await client.execute({
  sql: `SELECT
          SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS null_count,
          SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS filled_count,
          COUNT(*) AS total
        FROM knowledge_chunks`,
  args: [],
});
console.log(
  `  · after: total=${afterCounts.rows[0].total}, null=${afterCounts.rows[0].null_count}, filled=${afterCounts.rows[0].filled_count}`
);

if (Number(afterCounts.rows[0].null_count) > 0) {
  console.error("  FAIL — still have chunks with NULL user_id");
  process.exit(1);
}

// Per-user chunk distribution (first 5 users)
const dist = await client.execute({
  sql: `SELECT user_id, COUNT(*) AS c
        FROM knowledge_chunks
        GROUP BY user_id
        ORDER BY c DESC
        LIMIT 5`,
  args: [],
});
console.log("  · top users by chunk count:");
for (const row of dist.rows) {
  console.log(`      ${row.user_id}: ${row.c}`);
}

console.log("");
console.log("✅ knowledge_chunks.user_id rollout complete");
process.exit(0);
