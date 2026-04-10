#!/usr/bin/env node
/**
 * One-shot: create missing indexes on production Turso.
 * Usage: node scripts/db/create-indexes.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");

function loadEnv(filePath) {
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
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

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const indexes = [
  'CREATE INDEX IF NOT EXISTS "notes_user_idx" ON "notes" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "bookmarks_user_idx" ON "bookmarks" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "todos_user_idx" ON "todos" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "chat_messages_user_idx" ON "chat_messages" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "workflows_user_idx" ON "workflows" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "learning_paths_user_idx" ON "learning_paths" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "learning_lessons_path_idx" ON "learning_lessons" ("path_id")',
  'CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_idx" ON "workflow_runs" ("workflow_id")',
  'CREATE INDEX IF NOT EXISTS "token_usage_entries_user_idx" ON "token_usage_entries" ("user_id", "usage_at")',
  'CREATE INDEX IF NOT EXISTS "portfolio_holdings_user_idx" ON "portfolio_holdings" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "portfolio_news_user_idx" ON "portfolio_news" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "learning_topics_user_idx" ON "learning_topics" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "learning_notes_topic_idx" ON "learning_notes" ("topic_id")',
  'CREATE INDEX IF NOT EXISTS "learning_notes_user_idx" ON "learning_notes" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "learning_reviews_topic_idx" ON "learning_reviews" ("topic_id")',
  'CREATE INDEX IF NOT EXISTS "os_projects_user_idx" ON "os_projects" ("user_id")',
  'CREATE INDEX IF NOT EXISTS "os_project_notes_project_idx" ON "os_project_notes" ("project_id")',
  'CREATE INDEX IF NOT EXISTS "analysis_tasks_project_idx" ON "analysis_tasks" ("project_id")',
  'CREATE INDEX IF NOT EXISTS "analysis_tasks_status_idx" ON "analysis_tasks" ("status", "created_at")',
  'CREATE INDEX IF NOT EXISTS "analysis_messages_task_idx" ON "analysis_messages" ("task_id", "seq")',
  'CREATE INDEX IF NOT EXISTS "knowledge_index_jobs_source_idx" ON "knowledge_index_jobs" ("source_id")',
  'CREATE INDEX IF NOT EXISTS "knowledge_index_jobs_status_idx" ON "knowledge_index_jobs" ("status")',
  'CREATE INDEX IF NOT EXISTS "knowledge_chunks_source_idx" ON "knowledge_chunks" ("source_id")',
];

let ok = 0;
for (const sql of indexes) {
  try {
    await client.execute(sql);
    ok++;
    const name = sql.match(/"([^"]+)"/)?.[1];
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.error("  ❌ FAILED:", sql, e.message);
  }
}
console.log(`\n${ok}/${indexes.length} indexes created on production Turso`);

client.close();
