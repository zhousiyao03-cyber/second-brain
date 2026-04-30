/**
 * One-shot migration: move "study material" notes (interview prep / theory
 * articles) from `notes` into the `learning` module. After successful copy,
 * the source notes are HARD DELETED — there is no soft-delete column. Take a
 * Turso dump first.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-notes-to-learning.ts <config.json> [--env=local|prod] [--apply]
 *
 * Without `--apply` the script runs in dry-run mode and writes nothing.
 *
 * For `--env=prod` the script requires that `.env.turso-prod.local` provides
 * TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, and that a same-day dump file exists
 * at `backups/turso-YYYY-MM-DD.sql`. Without those guards it refuses to run.
 *
 * Config schema (config.json):
 *   {
 *     "userId": "<userId>",
 *     "topics": [
 *       { "topicName": "八股文", "source": { "kind": "folder", "folderName": "八股文" } },
 *       { "topicName": "React",  "source": { "kind": "noteIds", "ids": ["...", "..."] } },
 *       { "topicName": "Render", "source": { "kind": "tag", "tag": "browser" } }
 *     ],
 *     "deleteSourceNotes": true
 *   }
 */
import { createClient } from "@libsql/client";
import crypto from "node:crypto";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import * as schema from "../src/server/db/schema";

type SourceFolder = { kind: "folder"; folderName: string };
type SourceNoteIds = { kind: "noteIds"; ids: string[] };
type SourceTag = { kind: "tag"; tag: string };
type Source = SourceFolder | SourceNoteIds | SourceTag;

type TopicConfig = {
  topicName: string;
  source: Source;
};

type Config = {
  userId: string;
  topics: TopicConfig[];
  deleteSourceNotes?: boolean;
};

function parseArgs(argv: string[]): {
  configPath: string;
  env: "local" | "prod";
  apply: boolean;
} {
  const args = argv.slice(2);
  const configPath = args.find((a) => !a.startsWith("--"));
  if (!configPath) {
    throw new Error("Usage: tsx migrate-notes-to-learning.ts <config.json> [--env=local|prod] [--apply]");
  }
  const envArg = args.find((a) => a.startsWith("--env="));
  const env = envArg ? envArg.slice("--env=".length) : "local";
  if (env !== "local" && env !== "prod") {
    throw new Error(`--env must be 'local' or 'prod', got: ${env}`);
  }
  const apply = args.includes("--apply");
  return { configPath, env: env as "local" | "prod", apply };
}

function loadConfig(configPath: string): Config {
  const raw = fs.readFileSync(path.resolve(configPath), "utf8");
  const parsed = JSON.parse(raw) as Config;
  if (!parsed.userId) throw new Error("config.userId is required");
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
    throw new Error("config.topics must be a non-empty array");
  }
  for (const t of parsed.topics) {
    if (!t.topicName) throw new Error("each topic must have topicName");
    if (!t.source || !t.source.kind) {
      throw new Error(`topic ${t.topicName}: source.kind is required`);
    }
  }
  return parsed;
}

function loadProdEnv() {
  const envPath = path.resolve(".env.turso-prod.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `--env=prod requires .env.turso-prod.local; not found at ${envPath}`
    );
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function ensureTodayDump() {
  const today = new Date();
  const stamp = today.toISOString().slice(0, 10);
  const expected = path.resolve("backups", `turso-${stamp}.sql`);
  if (!fs.existsSync(expected)) {
    throw new Error(
      `Missing same-day prod dump. Run: turso db dump <db> > ${expected}`
    );
  }
  return expected;
}

async function confirmInteractive(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${prompt} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

type DbHandle = ReturnType<typeof drizzle<typeof schema>>;

async function fetchSourceNotes(
  db: DbHandle,
  userId: string,
  source: Source
) {
  if (source.kind === "folder") {
    const folderRows = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.userId, userId),
          eq(schema.folders.name, source.folderName)
        )
      );
    if (folderRows.length === 0) return [];
    const folderIds = folderRows.map((row) => row.id);
    return db
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.userId, userId),
          inArray(schema.notes.folderId, folderIds)
        )
      );
  }

  if (source.kind === "noteIds") {
    if (source.ids.length === 0) return [];
    return db
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.userId, userId),
          inArray(schema.notes.id, source.ids)
        )
      );
  }

  if (source.kind === "tag") {
    const allUserNotes = await db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.userId, userId));
    return allUserNotes.filter((note) => {
      if (!note.tags) return false;
      try {
        const arr = JSON.parse(note.tags);
        return Array.isArray(arr) && arr.includes(source.tag);
      } catch {
        return false;
      }
    });
  }

  return [];
}

async function findOrCreateTopic(
  db: DbHandle,
  userId: string,
  topicName: string,
  apply: boolean
) {
  const existing = await db
    .select({ id: schema.learningTopics.id })
    .from(schema.learningTopics)
    .where(
      and(
        eq(schema.learningTopics.userId, userId),
        eq(schema.learningTopics.title, topicName)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { id: existing[0]!.id, created: false };
  }

  const id = crypto.randomUUID();
  if (apply) {
    await db.insert(schema.learningTopics).values({
      id,
      userId,
      title: topicName,
    });
  }
  return { id, created: true };
}

async function fetchExistingTitlesInTopic(
  db: DbHandle,
  topicId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ title: schema.learningNotes.title })
    .from(schema.learningNotes)
    .where(eq(schema.learningNotes.topicId, topicId));
  return new Set(rows.map((row) => row.title));
}

async function main() {
  const { configPath, env, apply } = parseArgs(process.argv);
  const config = loadConfig(configPath);

  console.log(`config: ${configPath}`);
  console.log(`env:    ${env}`);
  console.log(`mode:   ${apply ? "APPLY (will write & delete)" : "dry-run"}`);

  if (env === "prod") {
    loadProdEnv();
    if (apply) {
      const dumpPath = ensureTodayDump();
      console.log(`prod dump: ${dumpPath} ✓`);
    } else {
      console.log("(dry-run skips dump check, but apply would require a same-day backups/turso-YYYY-MM-DD.sql)");
    }
  }

  const dbUrl =
    process.env.TURSO_DATABASE_URL ??
    `file:${path.join("data", "second-brain.db")}`;
  const isTurso = dbUrl.startsWith("libsql://");
  if (env === "prod" && !isTurso) {
    throw new Error(
      `--env=prod but TURSO_DATABASE_URL is not a libsql URL: ${dbUrl}`
    );
  }
  if (env === "local" && isTurso) {
    throw new Error(
      `--env=local but TURSO_DATABASE_URL points to a remote db: ${dbUrl}. Unset it or pass --env=prod.`
    );
  }

  const client = createClient({
    url: dbUrl,
    authToken: isTurso ? process.env.TURSO_AUTH_TOKEN : undefined,
  });
  const db = drizzle(client, { schema });

  let totalSearched = 0;
  let totalToInsert = 0;
  let totalSkipped = 0;
  let totalToDelete = 0;

  const plans: Array<{
    config: TopicConfig;
    topicId: string;
    topicCreated: boolean;
    notesToCopy: typeof schema.notes.$inferSelect[];
    skipTitles: string[];
  }> = [];

  for (const topicCfg of config.topics) {
    console.log(`\n── topic: ${topicCfg.topicName} (source: ${topicCfg.source.kind}) ──`);

    const sourceNotes = await fetchSourceNotes(
      db,
      config.userId,
      topicCfg.source
    );
    totalSearched += sourceNotes.length;
    console.log(`  found ${sourceNotes.length} source note(s)`);

    const { id: topicId, created: topicCreated } = await findOrCreateTopic(
      db,
      config.userId,
      topicCfg.topicName,
      apply
    );
    console.log(`  topic: ${topicCreated ? "WILL CREATE" : "reuse"} (${topicId})`);

    const existingTitles = await fetchExistingTitlesInTopic(db, topicId);
    const notesToCopy: typeof sourceNotes = [];
    const skipTitles: string[] = [];

    for (const note of sourceNotes) {
      if (existingTitles.has(note.title)) {
        skipTitles.push(note.title);
      } else {
        notesToCopy.push(note);
      }
    }

    totalToInsert += notesToCopy.length;
    totalSkipped += skipTitles.length;
    if (config.deleteSourceNotes) {
      totalToDelete += notesToCopy.length;
    }

    console.log(`  will copy ${notesToCopy.length} card(s)`);
    if (skipTitles.length > 0) {
      console.log(
        `  skipping ${skipTitles.length} duplicate(s) (title already in topic): ${skipTitles
          .slice(0, 3)
          .map((t) => `"${t}"`)
          .join(", ")}${skipTitles.length > 3 ? ", ..." : ""}`
      );
    }
    for (const note of notesToCopy.slice(0, 5)) {
      console.log(`    + ${note.title}`);
    }
    if (notesToCopy.length > 5) {
      console.log(`    ... and ${notesToCopy.length - 5} more`);
    }

    plans.push({
      config: topicCfg,
      topicId,
      topicCreated,
      notesToCopy,
      skipTitles,
    });
  }

  console.log("\n── summary ──");
  console.log(`  source notes considered: ${totalSearched}`);
  console.log(`  to insert (new cards):   ${totalToInsert}`);
  console.log(`  skipped (duplicate):     ${totalSkipped}`);
  console.log(
    `  to delete (source notes): ${
      config.deleteSourceNotes ? totalToDelete : 0
    }`
  );

  if (!apply) {
    console.log("\nDry-run only. Pass --apply to write & delete.");
    process.exit(0);
  }

  const ok = await confirmInteractive(
    `\nApply ${totalToInsert} insert(s)${
      config.deleteSourceNotes ? ` and ${totalToDelete} delete(s)` : ""
    } to ${env} db?`
  );
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }

  let inserted = 0;
  let deleted = 0;
  let failedTopics = 0;

  for (const plan of plans) {
    if (plan.notesToCopy.length === 0) {
      console.log(`\n[skip] ${plan.config.topicName}: nothing to insert`);
      continue;
    }
    console.log(`\n[apply] ${plan.config.topicName}: ${plan.notesToCopy.length} card(s)`);
    try {
      await db.transaction(async (tx) => {
        if (plan.topicCreated) {
          // already inserted in dry-run pass? no — only inserted when apply=true
          // (we passed apply=true here, but findOrCreateTopic was called once
          // upstream with apply param). Re-check: was it actually inserted?
          const exists = await tx
            .select({ id: schema.learningTopics.id })
            .from(schema.learningTopics)
            .where(eq(schema.learningTopics.id, plan.topicId))
            .limit(1);
          if (exists.length === 0) {
            await tx.insert(schema.learningTopics).values({
              id: plan.topicId,
              userId: config.userId,
              title: plan.config.topicName,
            });
          }
        }

        for (const note of plan.notesToCopy) {
          await tx.insert(schema.learningNotes).values({
            id: crypto.randomUUID(),
            topicId: plan.topicId,
            userId: config.userId,
            title: note.title,
            content: note.content,
            plainText: note.plainText,
            tags: note.tags,
            createdAt: note.createdAt ?? undefined,
            updatedAt: note.updatedAt ?? undefined,
          });
          inserted++;

          if (config.deleteSourceNotes) {
            await tx
              .delete(schema.notes)
              .where(eq(schema.notes.id, note.id));
            deleted++;
          }
        }
      });
      console.log(`  ✓ ${plan.notesToCopy.length} card(s) committed`);
    } catch (err) {
      failedTopics++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ topic "${plan.config.topicName}" failed: ${msg}`);
    }
  }

  console.log("\n── done ──");
  console.log(`  inserted: ${inserted}`);
  console.log(`  deleted:  ${deleted}`);
  console.log(`  failed topics: ${failedTopics}`);

  process.exit(failedTopics > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
