#!/usr/bin/env node
// Reconcile: 找出 Turso `knowledge_chunks` 里但不在 Milvus 里的 chunks，
// 用 e5-small (Transformers.js) 重新 embed 然后 upsert 到 Milvus。
//
// 用途：
//   - 修补今天 indexer Milvus upsert 全失败丢的 chunks
//   - 把之前 backfill 跳过的 dim-mismatch chunks 用 e5-small 重算入库
//   - 定期 reconcile，发现孤儿
//
// Usage:
//   node --env-file=.env.production scripts/reconcile-milvus.mjs --dry-run
//   node --env-file=.env.production scripts/reconcile-milvus.mjs
//
// 直连 libsql + Milvus + Transformers.js，不 import .ts，兼容 Node 22。

import { createClient } from "@libsql/client";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

// When set, exit with non-zero code if more than this many chunks were missing
// at the start of the run (before reconciliation). Used by the weekly cron to
// alarm on drift — under steady-state, we expect 0 missing, so any non-trivial
// number means indexer is dropping writes again.
const ALARM_THRESHOLD = Number(getArg("--alarm-threshold")) || null;

const VECTOR_DIM = 384;
const PAGE_SIZE = 200;
const EMBED_BATCH = 32;
const UPSERT_BATCH = 100;
const EXISTS_BATCH = 200;

if (!process.env.MILVUS_URI || !process.env.MILVUS_TOKEN) {
  console.error("MILVUS_URI / MILVUS_TOKEN 未设置");
  process.exit(1);
}
if (!process.env.TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL 未设置");
  process.exit(1);
}

const collectionName =
  process.env.MILVUS_COLLECTION || "knosi_knowledge_chunks";

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const milvus = new MilvusClient({
  address: process.env.MILVUS_URI,
  token: process.env.MILVUS_TOKEN,
});

await milvus.loadCollection({ collection_name: collectionName });

const { pipeline } = await import("@huggingface/transformers");
console.log("[reconcile] loading e5-small model...");
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/multilingual-e5-small",
  { dtype: "q8" }
);
console.log("[reconcile] model loaded.");

async function embedPassages(texts) {
  // e5-family 训练时 passage 用 "passage: " 前缀，retrieval query 用 "query: "。
  const prefixed = texts.map((t) => "passage: " + t);
  const tensor = await extractor(prefixed, { pooling: "mean", normalize: true });
  const dims = tensor.dims[1] ?? 0;
  if (dims !== VECTOR_DIM) {
    throw new Error(`expected dim ${VECTOR_DIM}, got ${dims}`);
  }
  const flat = Array.from(tensor.data);
  const out = [];
  for (let i = 0; i < texts.length; i += 1) {
    out.push(flat.slice(i * dims, (i + 1) * dims));
  }
  return out;
}

async function existsInMilvus(chunkIds) {
  const present = new Set();
  for (let i = 0; i < chunkIds.length; i += EXISTS_BATCH) {
    const batch = chunkIds.slice(i, i + EXISTS_BATCH);
    const list = batch.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(", ");
    const result = await milvus.query({
      collection_name: collectionName,
      filter: `chunk_id in [${list}]`,
      output_fields: ["chunk_id"],
      limit: batch.length,
    });
    for (const row of result.data ?? []) {
      present.add(String(row.chunk_id));
    }
  }
  return present;
}

let offset = 0;
let totalScanned = 0;
let totalMissing = 0;
let totalUpserted = 0;
let totalSkippedNoUserId = 0;

while (true) {
  const result = await turso.execute({
    sql: `
      SELECT id, user_id, source_type, source_id, text
      FROM knowledge_chunks
      ORDER BY id
      LIMIT ? OFFSET ?
    `,
    args: [PAGE_SIZE, offset],
  });

  if (result.rows.length === 0) break;
  totalScanned += result.rows.length;

  // 过滤掉没 userId 的（legacy，没法做用户隔离）
  const candidates = result.rows.filter((row) => {
    if (!row.user_id) {
      totalSkippedNoUserId += 1;
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    offset += PAGE_SIZE;
    continue;
  }

  const ids = candidates.map((row) => String(row.id));
  const present = await existsInMilvus(ids);
  const missing = candidates.filter((row) => !present.has(String(row.id)));
  totalMissing += missing.length;

  if (missing.length === 0) {
    console.log(
      `[reconcile] page offset=${offset}: ${candidates.length} ok, 0 missing`
    );
    offset += PAGE_SIZE;
    continue;
  }

  console.log(
    `[reconcile] page offset=${offset}: ${missing.length} missing — ${
      DRY_RUN ? "DRY RUN（跳过）" : "embed + upsert"
    }`
  );

  if (DRY_RUN) {
    offset += PAGE_SIZE;
    continue;
  }

  // Embed 分批（Transformers.js 单次太多会 OOM）
  const records = [];
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    const vectors = await embedPassages(batch.map((row) => String(row.text)));
    for (let j = 0; j < batch.length; j += 1) {
      records.push({
        chunk_id: String(batch[j].id),
        vector: vectors[j],
        user_id: String(batch[j].user_id),
        source_type: String(batch[j].source_type),
        source_id: String(batch[j].source_id),
      });
    }
  }

  // Upsert 分批
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    const upsertResult = await milvus.upsert({
      collection_name: collectionName,
      data: batch,
    });
    if (
      upsertResult.status?.error_code &&
      upsertResult.status.error_code !== "Success"
    ) {
      console.error(
        `[reconcile] upsert failed: ${upsertResult.status.error_code} ${
          upsertResult.status.reason ?? ""
        }`
      );
      process.exit(1);
    }
    totalUpserted += batch.length;
  }

  offset += PAGE_SIZE;
}

console.log(`\n[reconcile] 完成${DRY_RUN ? "（DRY RUN）" : ""}:`);
console.log(`  扫描 chunks            : ${totalScanned}`);
console.log(`  缺 userId 跳过         : ${totalSkippedNoUserId}`);
console.log(`  Milvus 缺失 chunks     : ${totalMissing}`);
console.log(`  补写到 Milvus          : ${totalUpserted}`);

if (ALARM_THRESHOLD !== null && totalMissing > ALARM_THRESHOLD) {
  console.error(
    `[reconcile] ALARM: missing=${totalMissing} > threshold=${ALARM_THRESHOLD}`
  );
  process.exit(1);
}
