#!/usr/bin/env node

/**
 * Production Turso rollout — drifter (AI text companion, Phase 1).
 *
 * Creates 3 new tables + 3 indexes for the drifter module. All tables are
 * brand new (no existing rows to migrate). Top-level rows include a foreign
 * key to users(id) ON DELETE CASCADE.
 *
 * Source: drizzle/0044_eager_sleepwalker.sql.
 *
 * Idempotent: detects existing tables/indexes and skips creation; always runs
 * the verification queries at the end.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

console.log("Production Turso rollout — drifter Phase 1");
console.log(`Target: ${url}`);
console.log("");

async function tableExists(name) {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

// 1. drifter_sessions (FK to users)
if (!(await tableExists("drifter_sessions"))) {
  console.log("Creating drifter_sessions...");
  await client.execute(`
    CREATE TABLE drifter_sessions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      day_number integer NOT NULL,
      weather text NOT NULL,
      time_of_day text NOT NULL,
      language text DEFAULT 'en' NOT NULL,
      started_at integer NOT NULL,
      ended_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    )
  `);
} else {
  console.log("Skip — drifter_sessions already exists.");
}

if (!(await indexExists("drifter_sessions_user_idx"))) {
  await client.execute(
    "CREATE INDEX drifter_sessions_user_idx ON drifter_sessions (user_id, started_at)",
  );
}

// 2. drifter_messages (FK to drifter_sessions)
if (!(await tableExists("drifter_messages"))) {
  console.log("Creating drifter_messages...");
  await client.execute(`
    CREATE TABLE drifter_messages (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      emotion text,
      status text DEFAULT 'complete' NOT NULL,
      hooks text,
      created_at integer NOT NULL,
      FOREIGN KEY (session_id) REFERENCES drifter_sessions(id) ON UPDATE no action ON DELETE cascade
    )
  `);
} else {
  console.log("Skip — drifter_messages already exists.");
}

if (!(await indexExists("drifter_messages_session_idx"))) {
  await client.execute(
    "CREATE INDEX drifter_messages_session_idx ON drifter_messages (session_id, created_at)",
  );
}

// 3. drifter_memories (FK to users + optional FK to drifter_messages)
if (!(await tableExists("drifter_memories"))) {
  console.log("Creating drifter_memories...");
  await client.execute(`
    CREATE TABLE drifter_memories (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      summary text NOT NULL,
      source_message_id text,
      importance integer DEFAULT 3 NOT NULL,
      created_at integer NOT NULL,
      last_referenced_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (source_message_id) REFERENCES drifter_messages(id) ON UPDATE no action ON DELETE set null
    )
  `);
} else {
  console.log("Skip — drifter_memories already exists.");
}

if (!(await indexExists("drifter_memories_user_idx"))) {
  await client.execute(
    "CREATE INDEX drifter_memories_user_idx ON drifter_memories (user_id, importance)",
  );
}

console.log("");
console.log("Verification:");

const expectedTables = [
  "drifter_sessions",
  "drifter_messages",
  "drifter_memories",
];
for (const t of expectedTables) {
  if (!(await tableExists(t))) {
    console.error(`  FAIL — missing table ${t}`);
    process.exit(1);
  }
  console.log(`  OK — table ${t} exists`);
}

const expectedIndexes = [
  "drifter_sessions_user_idx",
  "drifter_messages_session_idx",
  "drifter_memories_user_idx",
];
for (const i of expectedIndexes) {
  if (!(await indexExists(i))) {
    console.error(`  FAIL — missing index ${i}`);
    process.exit(1);
  }
  console.log(`  OK — index ${i} exists`);
}

// Verify users FK on drifter_sessions + drifter_memories
for (const t of ["drifter_sessions", "drifter_memories"]) {
  const fkResult = await client.execute({
    sql: `PRAGMA foreign_key_list('${t}')`,
  });
  const usersFk = fkResult.rows.find((r) => r.table === "users");
  if (!usersFk) {
    console.error(`  FAIL — ${t} missing FK to users(id)`);
    process.exit(1);
  }
  if (usersFk.on_delete !== "CASCADE") {
    console.error(
      `  FAIL — ${t}.user_id FK on_delete is ${usersFk.on_delete}, expected CASCADE`,
    );
    process.exit(1);
  }
  console.log(`  OK — ${t}.user_id → users(id) ON DELETE CASCADE`);
}

// Verify session FK on drifter_messages
{
  const fkResult = await client.execute({
    sql: `PRAGMA foreign_key_list('drifter_messages')`,
  });
  const sessionFk = fkResult.rows.find(
    (r) => r.table === "drifter_sessions",
  );
  if (!sessionFk) {
    console.error("  FAIL — drifter_messages missing FK to drifter_sessions(id)");
    process.exit(1);
  }
  if (sessionFk.on_delete !== "CASCADE") {
    console.error(
      `  FAIL — drifter_messages.session_id FK on_delete is ${sessionFk.on_delete}, expected CASCADE`,
    );
    process.exit(1);
  }
  console.log(
    "  OK — drifter_messages.session_id → drifter_sessions(id) ON DELETE CASCADE",
  );
}

console.log("");
console.log("✅ Production rollout verified: drifter Phase 1 schema is ready.");
