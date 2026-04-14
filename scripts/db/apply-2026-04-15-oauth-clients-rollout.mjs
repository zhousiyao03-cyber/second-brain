#!/usr/bin/env node
/**
 * One-shot production Turso rollout for the oauth_clients table.
 *
 * Reads Turso credentials from .env.turso-prod.local, applies
 * scripts/db/2026-04-15-oauth-clients-schema.sql, and runs verification
 * queries. Prints result, exits non-zero on failure.
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
  join(repoRoot, "scripts/db/2026-04-15-oauth-clients-schema.sql"),
  "utf8"
);

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
console.log(`Target host: ${new URL(url).host}`);
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

const tables = await client.execute({
  sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_clients'`,
  args: [],
});
const tableExists = tables.rows.length === 1;
console.log(`oauth_clients table exists: ${tableExists}`);
if (!tableExists) {
  console.error("  FAIL — oauth_clients table missing");
  process.exit(1);
}

const indexes = await client.execute({
  sql: `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='oauth_clients'`,
  args: [],
});
console.log(`oauth_clients indexes: ${indexes.rows.map((r) => r.name).join(", ")}`);
const hasUniqueIdx = indexes.rows.some(
  (r) =>
    r.name === "oauth_clients_client_id_idx" &&
    typeof r.sql === "string" &&
    r.sql.toUpperCase().includes("UNIQUE")
);
if (!hasUniqueIdx) {
  console.error("  FAIL — unique index oauth_clients_client_id_idx missing");
  process.exit(1);
}

const insertProbe = await client.execute({
  sql: `SELECT COUNT(*) AS n FROM oauth_clients`,
  args: [],
});
console.log(`Current row count: ${insertProbe.rows[0]?.n ?? 0}`);

console.log("");
console.log("All checks passed.");
