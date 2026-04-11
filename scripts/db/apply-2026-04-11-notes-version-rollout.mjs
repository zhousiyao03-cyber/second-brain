#!/usr/bin/env node
/**
 * Production Turso rollout — B1-3: add notes.version column.
 *
 * Adds a monotonically increasing `version INTEGER NOT NULL DEFAULT 0`
 * column to the `notes` table on the production Turso database.
 * This is a learning-phase change (B1-3), NOT an optimistic lock.
 * Design rationale is documented in docs/learn-backend/phase-b1.md.
 *
 * Reads Turso credentials from .env.turso-prod.local at the repo root.
 *
 * Usage:
 *   node scripts/db/apply-2026-04-11-notes-version-rollout.mjs
 *
 * Exits 0 on success (including idempotent re-runs), 1 on failure.
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

console.log("Production Turso rollout — B1-3: notes.version");
console.log(`Target: ${url}`);
console.log("");

// ─────────────────────────────────────────────
// Step 1: inspect current schema of notes table
// ─────────────────────────────────────────────
console.log("Step 1: inspect current notes schema");
const beforeCols = await client.execute("PRAGMA table_info(notes)");
const beforeNames = beforeCols.rows.map((r) => r.name);
console.log(`  columns before: ${beforeNames.join(", ")}`);
const alreadyHasVersion = beforeNames.includes("version");
console.log(`  version column already exists? ${alreadyHasVersion}`);
console.log("");

// ─────────────────────────────────────────────
// Step 2: apply ALTER (idempotent)
// ─────────────────────────────────────────────
console.log("Step 2: apply ALTER TABLE notes ADD COLUMN version");
if (alreadyHasVersion) {
  console.log("  SKIP — column already present, nothing to do");
} else {
  try {
    await client.execute(
      "ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 0"
    );
    console.log("  OK — column added");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.toLowerCase().includes("duplicate column")) {
      console.log("  SKIP — duplicate column (race with a concurrent run)");
    } else {
      console.error(`  FAIL — ${msg}`);
      process.exit(1);
    }
  }
}
console.log("");

// ─────────────────────────────────────────────
// Step 3: verify the column is present and queryable
// ─────────────────────────────────────────────
console.log("Step 3: verify");

const afterCols = await client.execute("PRAGMA table_info(notes)");
const versionCol = afterCols.rows.find((r) => r.name === "version");
if (!versionCol) {
  console.error("  FAIL — version column not found after ALTER");
  process.exit(1);
}
console.log(
  `  column present: name=${versionCol.name} type=${versionCol.type} notnull=${versionCol.notnull} dflt=${versionCol.dflt_value}`
);

const sample = await client.execute({
  sql: "SELECT id, version FROM notes LIMIT 5",
  args: [],
});
console.log(`  sample rows (${sample.rows.length}):`);
for (const row of sample.rows) {
  console.log(`    id=${row.id} version=${row.version}`);
}

const countRes = await client.execute(
  "SELECT COUNT(*) AS c, MIN(version) AS mn, MAX(version) AS mx FROM notes"
);
const stats = countRes.rows[0];
console.log(
  `  stats: total=${stats?.c} min_version=${stats?.mn} max_version=${stats?.mx}`
);

console.log("");
console.log("✅ Production rollout verified: notes.version exists, queryable, defaults to 0");
process.exit(0);
