#!/usr/bin/env node
/**
 * Production Turso rollout: add user_id to usage_records.
 *
 * Reads Turso credentials from .env.turso-prod.local, applies
 * scripts/db/2026-04-17-usage-records-user-id.sql, and runs verification.
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
  join(repoRoot, "scripts/db/2026-04-17-usage-records-user-id.sql"),
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
console.log(`Target: ${url}`);
console.log("");

// Pre-flight: verify the owner user exists.
const ownerCheck = await client.execute({
  sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
  args: ["zhousiyao03@gmail.com"],
});
if (ownerCheck.rows.length === 0) {
  console.error(
    "Pre-flight failed: no user with email zhousiyao03@gmail.com. Rewrite the SQL with the correct owner before retrying."
  );
  process.exit(1);
}
const ownerId = ownerCheck.rows[0].id;
console.log(`Pre-flight: owner user ${ownerId} resolved from email.`);

// Pre-flight: existing row count.
const before = await client.execute("SELECT COUNT(*) AS c FROM usage_records");
console.log(`Pre-flight: usage_records has ${before.rows[0].c} rows.`);
console.log("");

for (const [idx, stmt] of statements.entries()) {
  const head = stmt.replace(/\s+/g, " ").slice(0, 80);
  process.stdout.write(`[${idx + 1}/${statements.length}] ${head}... `);
  try {
    await client.execute(stmt);
    console.log("OK");
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    console.error("");
    console.error("Rollout aborted. The SQL uses BEGIN/COMMIT so partial changes should be rolled back.");
    process.exit(1);
  }
}

console.log("");
console.log("Verification:");

const after = await client.execute("SELECT COUNT(*) AS c FROM usage_records");
console.log(`  row count: ${after.rows[0].c} (before: ${before.rows[0].c})`);

const nullCheck = await client.execute(
  "SELECT COUNT(*) AS c FROM usage_records WHERE user_id IS NULL OR user_id = ''"
);
console.log(`  rows missing user_id: ${nullCheck.rows[0].c} (expect 0)`);

const indexCheck = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='index' AND name='usage_records_user_date_provider_model_idx'"
);
console.log(
  `  unique index present: ${indexCheck.rows.length > 0 ? "yes" : "NO — rollback required"}`
);

const schemaCheck = await client.execute(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='usage_records'"
);
console.log("");
console.log("Final schema:");
console.log(schemaCheck.rows[0]?.sql ?? "(missing)");

const ok =
  Number(after.rows[0].c) === Number(before.rows[0].c) &&
  Number(nullCheck.rows[0].c) === 0 &&
  indexCheck.rows.length > 0;

process.exit(ok ? 0 : 1);
