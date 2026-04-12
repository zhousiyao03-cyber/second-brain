#!/usr/bin/env node
/**
 * One-shot backfill: generate embeddings for all knowledge_chunks that
 * don't have a corresponding knowledge_chunk_embeddings row.
 *
 * Uses the Vercel AI SDK + Google Gemini (gemini-embedding-001) by default.
 * Requires GOOGLE_GENERATIVE_AI_API_KEY in the environment.
 *
 * Usage:
 *   # Local:
 *   node scripts/db/backfill-embeddings.mjs
 *
 *   # Production Turso:
 *   set -a && source .env.turso-prod.local && set +a \
 *     && node scripts/db/backfill-embeddings.mjs
 *
 * What it does:
 *   1. Find all chunks without embeddings
 *   2. Batch-embed their text via Gemini (batches of 20)
 *   3. Insert embedding rows into knowledge_chunk_embeddings
 *   4. Report progress and final counts
 *
 * Idempotent — safe to re-run. Skips chunks that already have embeddings.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");

// --- env ---
// Load .env.local if not already set (for local runs)
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  try {
    const envPath = join(repoRoot, ".env.local");
    const envContent = readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("❌ GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  process.exit(1);
}

// --- db ---
const dbUrl =
  process.env.TURSO_DATABASE_URL ?? `file:${join(repoRoot, "data", "local.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url: dbUrl,
  authToken,
});

// --- embedding ---
const EMBEDDING_MODEL = "gemini-embedding-001";
const BATCH_SIZE = 20;

const google = createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY });
const model = google.textEmbeddingModel(EMBEDDING_MODEL);

function normalizeVector(vector) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, v) => sum + v * v, 0)
  );
  if (!Number.isFinite(magnitude) || magnitude <= 0) return vector;
  return vector.map((v) => v / magnitude);
}

function vectorToBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}

// --- main ---
async function main() {
  console.log(`📊 Database: ${dbUrl.startsWith("file:") ? "local" : "Turso"}`);
  console.log(`🤖 Model: ${EMBEDDING_MODEL}`);
  console.log();

  // Find chunks without embeddings
  const { rows: missingRows } = await client.execute(`
    SELECT c.id, c.text
    FROM knowledge_chunks c
    LEFT JOIN knowledge_chunk_embeddings e ON e.chunk_id = c.id
    WHERE e.chunk_id IS NULL
    ORDER BY c.chunk_index
  `);

  const { rows: totalRows } = await client.execute(
    "SELECT COUNT(*) as cnt FROM knowledge_chunks"
  );
  const { rows: existingRows } = await client.execute(
    "SELECT COUNT(*) as cnt FROM knowledge_chunk_embeddings"
  );

  const totalChunks = Number(totalRows[0].cnt);
  const existingEmbeddings = Number(existingRows[0].cnt);
  const missing = missingRows.length;

  console.log(`📦 Total chunks: ${totalChunks}`);
  console.log(`✅ Existing embeddings: ${existingEmbeddings}`);
  console.log(`❌ Missing embeddings: ${missing}`);
  console.log();

  if (missing === 0) {
    console.log("✨ All chunks already have embeddings. Nothing to do.");
    return;
  }

  // Process in batches
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < missingRows.length; i += BATCH_SIZE) {
    const batch = missingRows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((row) => String(row.text));
    const ids = batch.map((row) => String(row.id));

    try {
      const { embeddings } = await embedMany({ model, values: texts });

      // Insert embeddings
      for (let j = 0; j < embeddings.length; j++) {
        const normalized = normalizeVector(embeddings[j]);
        const buffer = vectorToBuffer(normalized);

        await client.execute({
          sql: `INSERT OR IGNORE INTO knowledge_chunk_embeddings (chunk_id, model, dims, vector)
                VALUES (?, ?, ?, ?)`,
          args: [ids[j], EMBEDDING_MODEL, normalized.length, buffer],
        });
      }

      processed += batch.length;
      console.log(
        `  ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} chunks embedded (${processed}/${missing})`
      );
    } catch (error) {
      errors += batch.length;
      console.error(
        `  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`,
        error.message
      );
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < missingRows.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Final verification
  const { rows: finalRows } = await client.execute(
    "SELECT COUNT(*) as cnt FROM knowledge_chunk_embeddings"
  );
  const finalCount = Number(finalRows[0].cnt);

  console.log();
  console.log(`📊 Final results:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total embeddings now: ${finalCount}`);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
