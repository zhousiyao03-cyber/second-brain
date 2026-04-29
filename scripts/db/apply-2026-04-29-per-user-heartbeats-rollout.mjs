#!/usr/bin/env node

/**
 * Production Turso rollout — per-user daemon_heartbeats.
 *
 * Drops the old daemon_heartbeats table (PK on `kind` only, single global row
 * per kind) and recreates it with a composite PK (user_id, kind). Existing
 * rows have no user_id and cannot be migrated 1:1, so they are dropped — live
 * daemons repopulate within 60s on their next heartbeat.
 *
 * Source: drizzle/0039_acoustic_cloak.sql.
 *
 * Idempotent: detects the new schema by checking for the `user_id` column and
 * skips the drop+recreate path on a second run.
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

console.log("Production Turso rollout — per-user daemon_heartbeats");
console.log(`Target: ${url}`);
console.log("");

const existingColumns = await client.execute({
  sql: "PRAGMA table_info('daemon_heartbeats')",
});
const hasUserIdAlready = existingColumns.rows.some((r) => r.name === "user_id");

if (hasUserIdAlready) {
  console.log("Skip — daemon_heartbeats already has user_id column.");
} else {
  const oldRowCount = await client.execute({
    sql: "SELECT count(*) as n FROM daemon_heartbeats",
  });
  console.log(
    `Existing rows under the old schema: ${oldRowCount.rows[0]?.n ?? 0} (will be dropped; live daemons repopulate within 60s)`
  );

  await client.execute("PRAGMA foreign_keys = OFF");
  await client.execute("DROP TABLE daemon_heartbeats");
  await client.execute(`
    CREATE TABLE daemon_heartbeats (
      user_id text NOT NULL,
      kind text NOT NULL,
      last_seen_at integer NOT NULL,
      version text,
      PRIMARY KEY(user_id, kind),
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    )
  `);
  await client.execute("PRAGMA foreign_keys = ON");
}

await client.execute(
  `CREATE INDEX IF NOT EXISTS daemon_heartbeats_kind_last_seen_idx
   ON daemon_heartbeats (kind, last_seen_at)`
);

console.log("");
console.log("Verification:");

const tableResult = await client.execute({
  sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  args: ["daemon_heartbeats"],
});
if (tableResult.rows.length === 0) {
  console.error("  FAIL — missing table daemon_heartbeats");
  process.exit(1);
}
console.log("  OK — table daemon_heartbeats exists");

const indexResult = await client.execute({
  sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
  args: ["daemon_heartbeats_kind_last_seen_idx"],
});
if (indexResult.rows.length === 0) {
  console.error("  FAIL — missing index daemon_heartbeats_kind_last_seen_idx");
  process.exit(1);
}
console.log("  OK — index daemon_heartbeats_kind_last_seen_idx exists");

const columnResult = await client.execute({
  sql: "PRAGMA table_info('daemon_heartbeats')",
});
const expectedColumns = ["user_id", "kind", "last_seen_at", "version"];
const actualColumns = columnResult.rows.map((r) => r.name);
for (const col of expectedColumns) {
  if (!actualColumns.includes(col)) {
    console.error(`  FAIL — missing column ${col}`);
    process.exit(1);
  }
  console.log(`  OK — column ${col} exists`);
}

const userIdCol = columnResult.rows.find((r) => r.name === "user_id");
if (Number(userIdCol?.notnull) !== 1) {
  console.error("  FAIL — user_id should be NOT NULL");
  process.exit(1);
}
console.log("  OK — user_id is NOT NULL");

const pkPart = columnResult.rows.filter((r) => Number(r.pk) > 0);
const pkNames = pkPart
  .sort((a, b) => Number(a.pk) - Number(b.pk))
  .map((r) => r.name);
const expectedPk = ["user_id", "kind"];
if (
  pkNames.length !== expectedPk.length ||
  pkNames.some((n, i) => n !== expectedPk[i])
) {
  console.error(
    `  FAIL — primary key should be (user_id, kind), got (${pkNames.join(", ")})`
  );
  process.exit(1);
}
console.log("  OK — primary key is (user_id, kind)");

console.log("");
console.log("✅ Production rollout verified: per-user daemon_heartbeats is ready.");
