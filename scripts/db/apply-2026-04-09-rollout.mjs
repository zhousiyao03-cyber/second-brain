#!/usr/bin/env node
/**
 * One-shot production Turso rollout for the Ask AI daemon schema.
 *
 * Reads Turso credentials from .env.turso-prod.local, applies
 * scripts/db/2026-04-09-chat-daemon-schema.sql, and runs verification
 * queries. Prints result, exits non-zero on failure.
 *
 * Usage:
 *   node scripts/db/apply-2026-04-09-rollout.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");

function loadEnv(path) {
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
}

loadEnv(join(repoRoot, ".env.turso-prod.local"));

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const client = createClient({ url, authToken });

const schemaSql = readFileSync(
  join(repoRoot, "scripts/db/2026-04-09-chat-daemon-schema.sql"),
  "utf8"
);

// Extract only non-comment DDL statements separated by ";"
function extractStatements(sql) {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const statements = extractStatements(schemaSql);

console.log(`Applying ${statements.length} DDL statements to production Turso...`);
console.log(`Target: ${url}`);
console.log("");

for (const [idx, stmt] of statements.entries()) {
  const head = stmt.replace(/\s+/g, " ").slice(0, 80);
  process.stdout.write(`[${idx + 1}/${statements.length}] ${head}... `);
  try {
    await client.execute(stmt);
    console.log("OK");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.includes("already exists")) {
      console.log(`SKIP (already exists)`);
    } else {
      console.log("FAIL");
      console.error(`  error: ${msg}`);
      process.exit(1);
    }
  }
}

console.log("");
console.log("Running verification queries...");
console.log("");

// 1. Tables present
const tables = await client.execute({
  sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?) ORDER BY name`,
  args: ["chat_tasks", "daemon_chat_messages", "daemon_heartbeats"],
});
const tableNames = tables.rows.map((row) => row.name);
console.log(`Tables: ${tableNames.join(", ")}`);
if (tableNames.length !== 3) {
  console.error("  FAIL — expected 3 tables, got " + tableNames.length);
  process.exit(1);
}

// 2. Index on chat_tasks is NOT unique
const idx = await client.execute({
  sql: `SELECT sql FROM sqlite_master WHERE name='chat_tasks_status_created_idx'`,
  args: [],
});
const idxSql = idx.rows[0]?.sql ?? "";
console.log(`chat_tasks_status_created_idx SQL: ${idxSql}`);
if (idxSql.toUpperCase().includes("UNIQUE")) {
  console.error("  FAIL — index is UNIQUE, expected non-unique");
  process.exit(1);
}

// 3. Legacy chat_messages table untouched (should still exist with its own row count)
const legacy = await client.execute({
  sql: `SELECT COUNT(*) AS c FROM chat_messages`,
  args: [],
});
console.log(`Legacy chat_messages row count: ${legacy.rows[0]?.c}`);

// 4. Daemon unique index
const daemonIdx = await client.execute({
  sql: `SELECT sql FROM sqlite_master WHERE name='daemon_chat_messages_task_seq_idx'`,
  args: [],
});
const daemonIdxSql = daemonIdx.rows[0]?.sql ?? "";
console.log(`daemon_chat_messages_task_seq_idx SQL: ${daemonIdxSql}`);
if (!daemonIdxSql.toUpperCase().includes("UNIQUE")) {
  console.error("  FAIL — daemon task_seq idx should be UNIQUE");
  process.exit(1);
}

console.log("");
console.log("✅ Production rollout verified");
process.exit(0);
