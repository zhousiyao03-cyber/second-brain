/**
 * One-shot migration: re-embed every chunk in knowledge_chunks using
 * Transformers.js / Xenova/multilingual-e5-small (384-dim).
 *
 * Why: we are switching the embedding provider away from Gemini
 * (3072-dim) because the free-tier daily quota was killing async
 * indexing — see docs/changelog/. New vectors are produced in-process
 * with no API quota.
 *
 * Run: node scripts/reembed-all.mjs
 *
 * Steps:
 *   1. Dump existing rows to a timestamped JSON in case we need to roll back.
 *   2. DELETE FROM knowledge_chunk_embeddings.
 *   3. Select all chunks ordered by source_updated_at DESC (recent first —
 *      so the user sees recent notes searchable as soon as possible).
 *   4. Embed in batches of 32, INSERT rows, repeat.
 *
 * Idempotent: if interrupted mid-run, re-running picks up unembedded
 * chunks (the same NOT EXISTS guard the backfill script uses).
 */
import { createClient } from "@libsql/client";
import { pipeline } from "@huggingface/transformers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("D:/repos/knosi/.env.turso-prod.local", "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
    })
);

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const MODEL_ID = "Xenova/multilingual-e5-small";
const BATCH_SIZE = 32;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_DUMP = process.argv.includes("--skip-dump");

function vectorToBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}

async function dumpExisting() {
  console.log("Dumping existing embeddings for safety...");
  const rows = await client.execute(
    `SELECT chunk_id, model, dims, hex(vector) as vector_hex, created_at
     FROM knowledge_chunk_embeddings`
  );
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("./tmp", { recursive: true });
  const path = `./tmp/embeddings-backup-${ts}.json`;
  writeFileSync(path, JSON.stringify(rows.rows, null, 2));
  console.log(`  dumped ${rows.rows.length} rows to ${path}`);
}

async function clearOldEmbeddings() {
  console.log("Clearing knowledge_chunk_embeddings...");
  const r = await client.execute(`DELETE FROM knowledge_chunk_embeddings`);
  console.log(`  deleted ${r.rowsAffected} rows`);
}

async function getOrphanBatch(limit) {
  const r = await client.execute({
    sql: `SELECT c.id, c.text FROM knowledge_chunks c
          WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunk_embeddings e WHERE e.chunk_id = c.id)
          ORDER BY c.source_updated_at DESC, c.created_at DESC
          LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((row) => ({ id: row.id, text: row.text }));
}

async function totalRemaining() {
  const r = await client.execute(
    `SELECT count(*) as n FROM knowledge_chunks c
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunk_embeddings e WHERE e.chunk_id = c.id)`
  );
  return Number(r.rows[0].n);
}

async function totalChunks() {
  const r = await client.execute(`SELECT count(*) as n FROM knowledge_chunks`);
  return Number(r.rows[0].n);
}

async function insertEmbeddings(chunks, vectors, dims) {
  const now = Math.floor(Date.now() / 1000);
  const placeholders = chunks.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const args = [];
  for (let i = 0; i < chunks.length; i++) {
    args.push(
      chunks[i].id,
      MODEL_ID,
      dims,
      vectorToBuffer(vectors[i]),
      now
    );
  }
  await client.execute({
    sql: `INSERT INTO knowledge_chunk_embeddings (chunk_id, model, dims, vector, created_at)
          VALUES ${placeholders}`,
    args,
  });
}

async function main() {
  console.log(`Loading model ${MODEL_ID}...`);
  const t0 = Date.now();
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    dtype: "q8",
  });
  console.log(`  loaded in ${Date.now() - t0}ms`);

  const total = await totalChunks();
  console.log(`\nDB state: ${total} chunks total\n`);

  if (DRY_RUN) {
    console.log("DRY RUN — would dump + delete + re-embed everything");
    const sample = await getOrphanBatch(3);
    console.log("Sample orphans (none expected after delete):", sample.length);
    return;
  }

  if (!SKIP_DUMP) await dumpExisting();
  await clearOldEmbeddings();

  let done = 0;
  while (true) {
    const batch = await getOrphanBatch(BATCH_SIZE);
    if (batch.length === 0) {
      console.log("\n✅ all chunks have embeddings");
      break;
    }
    const tStart = Date.now();
    // e5: 文档侧用 "passage: " 前缀
    const tensor = await extractor(
      batch.map((c) => "passage: " + c.text),
      { pooling: "mean", normalize: true }
    );
    const dims = tensor.dims[1];
    const flat = Array.from(tensor.data);
    const vectors = batch.map((_, i) => flat.slice(i * dims, (i + 1) * dims));

    await insertEmbeddings(batch, vectors, dims);
    done += batch.length;
    const remaining = await totalRemaining();
    console.log(
      `[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ` +
      `+${batch.length} done=${done} remaining=${remaining} ` +
      `(${Date.now() - tStart}ms)`
    );
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
