#!/usr/bin/env node

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
const sqlPath = join(repoRoot, "scripts", "db", "2026-04-12-claude-knosi-capture.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

console.log("Production Turso rollout — Claude Knosi capture OAuth tables");
console.log(`Target: ${url}`);
console.log("");

for (const [index, statement] of statements.entries()) {
  console.log(`Step ${index + 1}: apply statement`);
  await client.execute(statement);
}

console.log("");
console.log("Verification:");
for (const table of [
  "oauth_authorization_codes",
  "oauth_refresh_tokens",
  "oauth_access_tokens",
]) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  if (result.rows.length === 0) {
    console.error(`  FAIL — missing table ${table}`);
    process.exit(1);
  }
  console.log(`  OK — table ${table} exists`);
}

for (const indexName of [
  "oauth_authorization_codes_code_hash_idx",
  "oauth_refresh_tokens_token_hash_idx",
  "oauth_access_tokens_token_hash_idx",
]) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    args: [indexName],
  });
  if (result.rows.length === 0) {
    console.error(`  FAIL — missing index ${indexName}`);
    process.exit(1);
  }
  console.log(`  OK — index ${indexName} exists`);
}

console.log("");
console.log("✅ Production rollout verified: Claude Knosi capture OAuth tables are present.");
