#!/usr/bin/env node
/**
 * Production Turso rollout — Agent Context Layer Phase 1: preferences table.
 *
 * Creates the `preferences` table + 2 indexes on production Turso.
 *
 * Schema source: drizzle/0045_crazy_yellow_claw.sql
 * Spec: docs/superpowers/specs/2026-05-02-knosi-agent-context-layer-phase1-design.md
 * Plan: docs/superpowers/plans/2026-05-02-knosi-agent-context-layer-phase1.md
 *
 * Reads Turso credentials from .env.turso-prod.local at the repo root.
 *
 * Usage:
 *   node scripts/db/apply-2026-05-02-preferences-rollout.mjs
 *
 * Idempotent — re-running after the table exists is a no-op.
 * Exits 0 on success, 1 on failure.
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

console.log("Production Turso rollout — ACL Phase 1: preferences");
console.log(`Target: ${url}`);
console.log("");

// ─────────────────────────────────────────────
// Step 1: inspect current state
// ─────────────────────────────────────────────
console.log("Step 1: inspect current state");
const tableCheck = await client.execute({
  sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='preferences'",
  args: [],
});
const tableExists = tableCheck.rows.length > 0;
console.log(`  preferences table already exists? ${tableExists}`);
console.log("");

// ─────────────────────────────────────────────
// Step 2: create table + indexes (idempotent)
// ─────────────────────────────────────────────
console.log("Step 2: create table + indexes");
if (tableExists) {
  console.log("  SKIP — table already present, nothing to do");
} else {
  try {
    await client.execute(`
      CREATE TABLE preferences (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        scope text NOT NULL,
        key text NOT NULL,
        value text NOT NULL,
        description text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
      )
    `);
    console.log("  OK — table created");

    await client.execute(
      "CREATE UNIQUE INDEX preferences_user_scope_key_idx ON preferences (user_id, scope, key)"
    );
    console.log("  OK — unique index created");

    await client.execute(
      "CREATE INDEX preferences_user_scope_idx ON preferences (user_id, scope)"
    );
    console.log("  OK — secondary index created");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already exists")) {
      console.log(`  SKIP — ${msg} (race with a concurrent run)`);
    } else {
      console.error(`  FAIL — ${msg}`);
      process.exit(1);
    }
  }
}
console.log("");

// ─────────────────────────────────────────────
// Step 3: verify schema + indexes
// ─────────────────────────────────────────────
console.log("Step 3: verify");

const cols = await client.execute("PRAGMA table_info(preferences)");
if (cols.rows.length === 0) {
  console.error("  FAIL — preferences table not present after Step 2");
  process.exit(1);
}
const expectedCols = [
  "id",
  "user_id",
  "scope",
  "key",
  "value",
  "description",
  "created_at",
  "updated_at",
];
const actualCols = cols.rows.map((r) => r.name);
const missing = expectedCols.filter((c) => !actualCols.includes(c));
if (missing.length) {
  console.error(`  FAIL — missing columns: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`  columns: ${actualCols.join(", ")}`);

const indexCheck = await client.execute({
  sql: "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='preferences' ORDER BY name",
  args: [],
});
const indexNames = indexCheck.rows.map((r) => r.name);
console.log(`  indexes: ${indexNames.join(", ")}`);
const expectedIndexes = [
  "preferences_user_scope_idx",
  "preferences_user_scope_key_idx",
];
const missingIndexes = expectedIndexes.filter((i) => !indexNames.includes(i));
if (missingIndexes.length) {
  console.error(`  FAIL — missing indexes: ${missingIndexes.join(", ")}`);
  process.exit(1);
}

const countRes = await client.execute("SELECT COUNT(*) AS c FROM preferences");
console.log(`  row count: ${countRes.rows[0]?.c}`);

console.log("");
console.log(
  "✅ Production rollout verified: preferences table + 2 indexes present and queryable"
);
process.exit(0);
