#!/usr/bin/env node

/**
 * Production Turso rollout — council multi-agent room (Phase 1).
 *
 * Creates 4 new tables + 4 indexes for the council module. All tables are
 * brand new (no existing rows to migrate). The two top-level tables include
 * a foreign key to users(id) ON DELETE CASCADE.
 *
 * Source: drizzle/0042_salty_nomad.sql + drizzle/0043_uneven_network.sql.
 *
 * Idempotent: detects existing tables and skips creation; always runs the
 * verification queries at the end.
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

console.log("Production Turso rollout — council Phase 1");
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

// 1. council_personas (with users FK from migration 0043)
if (!(await tableExists("council_personas"))) {
  console.log("Creating council_personas...");
  await client.execute(`
    CREATE TABLE council_personas (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      name text NOT NULL,
      avatar_emoji text,
      system_prompt text NOT NULL,
      style_hint text,
      scope_kind text NOT NULL,
      scope_ref_id text,
      scope_tags text,
      is_preset integer DEFAULT false NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    )
  `);
} else {
  console.log("Skip — council_personas already exists.");
}

if (!(await indexExists("council_personas_user_idx"))) {
  await client.execute(
    "CREATE INDEX council_personas_user_idx ON council_personas (user_id)",
  );
}

// 2. council_channels (with users FK)
if (!(await tableExists("council_channels"))) {
  console.log("Creating council_channels...");
  await client.execute(`
    CREATE TABLE council_channels (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      name text NOT NULL,
      topic text,
      hard_limit_per_turn integer DEFAULT 6 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    )
  `);
} else {
  console.log("Skip — council_channels already exists.");
}

if (!(await indexExists("council_channels_user_idx"))) {
  await client.execute(
    "CREATE INDEX council_channels_user_idx ON council_channels (user_id)",
  );
}

// 3. council_channel_personas (junction)
if (!(await tableExists("council_channel_personas"))) {
  console.log("Creating council_channel_personas...");
  await client.execute(`
    CREATE TABLE council_channel_personas (
      channel_id text NOT NULL,
      persona_id text NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY(channel_id, persona_id),
      FOREIGN KEY (channel_id) REFERENCES council_channels(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (persona_id) REFERENCES council_personas(id) ON UPDATE no action ON DELETE restrict
    )
  `);
} else {
  console.log("Skip — council_channel_personas already exists.");
}

// 4. council_channel_messages
if (!(await tableExists("council_channel_messages"))) {
  console.log("Creating council_channel_messages...");
  await client.execute(`
    CREATE TABLE council_channel_messages (
      id text PRIMARY KEY NOT NULL,
      channel_id text NOT NULL,
      role text NOT NULL,
      persona_id text,
      content text NOT NULL,
      status text DEFAULT 'complete' NOT NULL,
      turn_id text,
      metadata text,
      created_at integer NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES council_channels(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (persona_id) REFERENCES council_personas(id) ON UPDATE no action ON DELETE set null
    )
  `);
} else {
  console.log("Skip — council_channel_messages already exists.");
}

if (!(await indexExists("council_messages_channel_idx"))) {
  await client.execute(
    "CREATE INDEX council_messages_channel_idx ON council_channel_messages (channel_id, created_at)",
  );
}
if (!(await indexExists("council_messages_turn_idx"))) {
  await client.execute(
    "CREATE INDEX council_messages_turn_idx ON council_channel_messages (turn_id)",
  );
}

console.log("");
console.log("Verification:");

const expectedTables = [
  "council_personas",
  "council_channels",
  "council_channel_personas",
  "council_channel_messages",
];
for (const t of expectedTables) {
  if (!(await tableExists(t))) {
    console.error(`  FAIL — missing table ${t}`);
    process.exit(1);
  }
  console.log(`  OK — table ${t} exists`);
}

const expectedIndexes = [
  "council_personas_user_idx",
  "council_channels_user_idx",
  "council_messages_channel_idx",
  "council_messages_turn_idx",
];
for (const i of expectedIndexes) {
  if (!(await indexExists(i))) {
    console.error(`  FAIL — missing index ${i}`);
    process.exit(1);
  }
  console.log(`  OK — index ${i} exists`);
}

// Verify users FK on council_personas + council_channels
for (const t of ["council_personas", "council_channels"]) {
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

console.log("");
console.log("✅ Production rollout verified: council Phase 1 schema is ready.");
