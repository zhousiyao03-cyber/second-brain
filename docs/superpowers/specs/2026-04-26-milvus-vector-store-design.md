# Milvus Vector Store Migration — Design Spec

**Date:** 2026-04-26
**Status:** Draft (awaiting user review)
**Scope:** Replace SQLite blob + in-process dot product with Milvus (Zilliz Cloud Serverless free tier) for the embedding storage and ANN search path. Keep all other RAG behavior identical. Out of scope: agentic RAG (LLM-driven retrieval orchestration), BM25 storage migration, multi-collection partitioning. Each of those is a separate spec.

## Motivation

The current retrieval pipeline in [agentic-rag.ts](../../../src/server/ai/agentic-rag.ts):

1. Loads **all** of a user's `knowledge_chunks` rows into Node memory (line 137).
2. Loads **all** of that user's embedding blobs into Node memory (line 223).
3. Runs BM25 in-process over the chunk text via MiniSearch.
4. Computes cosine-equivalent dot product against every embedding row.
5. RRF-fuses the two ranked lists, expands seeds to ±1 neighbors, returns top-16.

This is correct and fast at the current 200-chunk scale. It will not stay fast as the corpus grows: every query is O(n) memory and O(n·d) CPU for the embedding pass alone. Beyond ~10K chunks, p95 query latency degrades visibly; beyond ~100K, the Node process starts pressuring the 4GB Hetzner VPS just to hold the vectors.

The migration is also a deliberate learning exercise. The owner wants hands-on experience with a dedicated vector database, specifically: collection schema design, HNSW parameter tuning, filtered-ANN expression syntax, and recall@k evaluation against ground truth.

The non-goals matter equally. We are not building a 100K-scale system tonight, not changing the BM25 path (still in-process MiniSearch over chunk text), not introducing agentic retrieval, and not switching embedding models. The change is narrowly scoped to the embedding storage tier so that the eval harness produced as a side effect can later be reused to measure the agentic upgrade independently.

## Architecture

### Storage layout

| Concern | Before | After |
|---|---|---|
| `knowledge_chunks` (text + metadata + section path) | Turso/libsql | Turso/libsql (unchanged) |
| `knowledge_chunk_embeddings` (vector blobs) | Turso/libsql | **Removed** — vectors live in Milvus |
| Embedding generation | In-process Transformers.js | In-process Transformers.js (unchanged) |
| ANN search | In-process dot product over all rows | Milvus HNSW with `expr: "user_id == ?"` filter |
| BM25 keyword search | In-process MiniSearch | In-process MiniSearch (unchanged) |
| Result fusion | RRF in Node | RRF in Node (unchanged) |

Milvus is treated as a **derived index of Turso**. The text and metadata stay canonical in Turso; Milvus only stores `chunk_id → vector + filter metadata`. If the Milvus collection is dropped, a single backfill script can rebuild it from Turso. This invariant constrains the schema to the minimum required for filtered ANN — no chunk text, no section path, no source title.

### Collection schema

Collection name: `knosi_knowledge_chunks`

| Field | Type | Notes |
|---|---|---|
| `chunk_id` | `VARCHAR(64)`, primary key, no auto-id | Matches `knowledge_chunks.id` (UUID v4 fits in 36 chars; 64 leaves headroom) |
| `vector` | `FLOAT_VECTOR(384)` | Dimension fixed by `Xenova/multilingual-e5-small` |
| `user_id` | `VARCHAR(64)` | The single most important filter — required for tenant isolation |
| `source_type` | `VARCHAR(8)` | `"note"` or `"bookmark"` — used by scope filters |
| `source_id` | `VARCHAR(64)` | Used for batch deletion when a note/bookmark is removed |

Index on `vector`: HNSW, `metric_type=COSINE`, `M=16`, `efConstruction=200`. Search-time `ef=64` as the starting point, tuned later via the eval harness. COSINE rather than IP because the e5 model output is not strictly L2-normalized in the current Transformers.js path; COSINE is invariant to magnitude and removes a class of correctness bugs.

Scalar indexes: none initially. Filter selectivity on `user_id` is high (single-user dev, expected ≤10 users in v1) and Milvus's brute-force filter eval is acceptable below ~100K rows. If filter cost becomes visible later, add an inverted index on `user_id`.

The dimension and metric are baked into the collection at creation time and cannot be changed in place. If the embedding model is ever swapped (e.g. to a 768-dim model), the migration is: create a parallel collection, dual-write during transition, repoint reads, drop the old. That contingency is documented but not implemented now.

### Retrieval flow

The `retrieveAgenticContext` function in `agentic-rag.ts` is restructured. Behavior is preserved end-to-end; only the semantic-retrieval middle is replaced.

```
input:  query, userId, scope
output: top-16 expanded chunks (unchanged shape)

step 1  load scoped chunks from Turso              ← unchanged
        (still O(n) for now; future BM25 migration would fix)
step 2  build MiniSearch index from scoped chunks  ← unchanged
        run keyword search → top KEYWORD_LIMIT (18) bm25Results
step 3  embed query via Transformers.js            ← unchanged
step 4  if vectorStore is null → skip; semanticMatches = []
        else: call vectorStore.searchSimilar({       ← NEW: replaces in-memory dot product
          userId, queryVector,
          topK: SEMANTIC_LIMIT (18),
          sourceTypes: scope-derived
        })
        returns [{ chunkId, score }, ...]
        any chunkId not present in scopedChunks (orphan from a partial
        delete) is dropped before fusion
step 5  RRF fuse keyword + semantic ranks          ← unchanged (weights 1.0 / 1.3)
        seedChunks = top SEED_LIMIT (8)
step 6  expand each seed to chunkIndex ±1 neighbors ← unchanged
step 7  sort + slice to FINAL_LIMIT (16)            ← unchanged
```

Steps 2 and 4 run in parallel (`Promise.all`). The Milvus call is the only network hop in the hot path; expected latency is dominated by Zilliz round-trip (50-200ms from Hetzner Nuremberg to Zilliz US/Singapore). For the first version this is acceptable. If it becomes a problem, options include caching the e5 query embedding for repeated queries and choosing a Zilliz region closer to Hetzner.

### `vector-store.ts` abstraction

A single module owns all Milvus interaction so the rest of the codebase never imports the Milvus SDK directly. This is both for testability (the seam can be mocked) and for portability (if we ever swap to Qdrant or libsql vector, only this file changes).

```ts
// src/server/ai/vector-store.ts
export interface VectorRecord {
  chunkId: string;
  userId: string;
  sourceType: "note" | "bookmark";
  sourceId: string;
  vector: number[];
}

export interface VectorSearchResult {
  chunkId: string;
  score: number;
}

export interface VectorStore {
  ensureCollection(): Promise<void>;
  upsertChunkVectors(records: VectorRecord[]): Promise<void>;
  existsByChunkIds(chunkIds: string[]): Promise<Set<string>>;
  searchSimilar(opts: {
    userId: string;
    queryVector: number[];
    topK: number;
    sourceTypes?: ("note" | "bookmark")[];
  }): Promise<VectorSearchResult[]>;
  deleteByChunkIds(chunkIds: string[]): Promise<void>;
  deleteBySource(sourceId: string): Promise<void>;
}

// Returns null when MILVUS_URI is unset, mirroring the embeddings.ts
// "provider mode = none" pattern. Callers must null-check.
export function getVectorStore(): VectorStore | null;
```

`getVectorStore()` returns a lazy singleton. The first call constructs the Milvus client from `MILVUS_URI` and `MILVUS_TOKEN` env vars and runs `ensureCollection()` (idempotent). All callers use the singleton.

`upsertChunkVectors` batches internally — Milvus accepts up to several MB per insert request; we cap at 100 records per batch to keep request size predictable and partial-failure recovery simple. The function is idempotent on `chunk_id` because the schema uses an explicit primary key (no auto-id).

`searchSimilar` builds an `expr` string of the form `user_id == "..." && source_type in ["note", "bookmark"]`. The user_id quoting uses Milvus's parameter syntax to avoid expression injection — even though `userId` comes from server-trusted session, treating it as untrusted input is the correct default.

### Indexer changes

[indexer.ts](../../../src/server/ai/indexer.ts) currently performs `knowledge_chunks` and `knowledge_chunk_embeddings` writes as separate non-transactional steps (lines 243 and 251). On embedding failure the catch block (line 262) marks the job `failed` and rethrows; the chunk row is preserved because nothing rolled it back. The existing helper `fillMissingEmbeddingsForExistingChunks` (line 114) detects orphaned chunks on the next sync pass and embeds them. This is exactly the retry pattern we want — the migration reuses the structure unchanged and only swaps the storage backend.

Concrete changes inside `syncSourceIndex`:

1. Line 251-258 (`db.insert(knowledgeChunkEmbeddings)`) is replaced by:
   ```ts
   await vectorStore.upsertChunkVectors(
     embedded.vectors.map((vector, index) => ({
       chunkId: insertedChunks[index]!.id,
       userId,
       sourceType,
       sourceId,
       vector,
     }))
   );
   ```
2. `fillMissingEmbeddingsForExistingChunks` is renamed to `fillMissingVectorsForExistingChunks`. The "missing" check switches from "chunkId not in `knowledge_chunk_embeddings`" to "chunkId not in Milvus" via a new `vectorStore.existsByChunkIds(ids)` method. The body is otherwise identical: embed missing chunks, upsert to Milvus.
3. `deleteChunkRows` (line 78) drops its `db.delete(knowledgeChunkEmbeddings)` call (line 92-95) and adds `await vectorStore.deleteByChunkIds(chunkIds)` after computing the chunkIds list. If the Milvus delete fails, the catch in the caller marks the job failed; on retry, the chunks have already been removed from Turso so the second pass is a no-op delete.

If `MILVUS_URI` is unset (matching the `EMBEDDING_PROVIDER=none` pattern), `vectorStore` is null and the upsert / delete calls are skipped. This preserves the existing E2E test path where embeddings are disabled entirely.

There is no two-phase commit and no outbox table. The accepted inconsistency window is bounded by the job retry cadence (currently a few seconds via the queue) and Zilliz uptime, which is high enough for this scale that paying for stronger guarantees is not worth the code.

Deletion of a note or bookmark goes through `deleteChunkRows` as above. If the Milvus delete is partially successful (say, one batch out of three), the orphans point to chunkIds that no longer exist in Turso. The search path defensively drops Milvus results that don't resolve to a Turso row, so orphans are invisible. They consume Milvus storage until manually reconciled via `backfill-milvus.mjs --rebuild`.

### Backfill

A one-shot script `scripts/backfill-milvus.mjs` rebuilds Milvus from Turso. It is the single source of truth for "make Milvus consistent with Turso" and is used both for initial migration and for any future recovery from corruption.

```
1. Load env, connect to Turso and Milvus.
2. ensureCollection() — no-op if exists.
3. Optional --rebuild flag: drop and recreate the collection.
4. Page through `knowledge_chunk_embeddings` JOIN `knowledge_chunks`,
   200 rows per page.
5. Map each row to a VectorRecord. The embedding blob deserializes via the
   existing vectorBufferToArray helper in embeddings.ts.
6. Batch upsert in groups of 100. Log progress every batch.
7. On batch failure, write the failing chunkIds to
   .backfill-milvus-failed.json and continue. Re-run with --resume reads
   that file and only retries those rows.
8. After all batches succeed, sanity check:
     count(Turso knowledge_chunk_embeddings) == count(Milvus collection)
   Mismatch is a hard error, exit non-zero.
```

The script is idempotent because the schema uses explicit primary keys. Re-running on a partially-loaded collection is safe.

### Cutover sequence

The migration ships in three commits, each independently reversible:

**Commit 1 — Write side.** Add `vector-store.ts`, add Milvus SDK dependency, add env vars, add `ensureCollection()` startup hook, modify `indexer.ts` to dual-write (Turso embeddings table AND Milvus). Reads still come from `knowledge_chunk_embeddings`. Run the backfill script once. Observe `knowledge_index_jobs` for failure rates over a day or two.

**Commit 2 — Read side.** Modify `agentic-rag.ts` to use `vectorStore.searchSimilar(...)` instead of fetching blobs and computing dot product. The `knowledge_chunk_embeddings` write is dropped from the indexer in this commit (no point dual-writing once reads have moved). The `knowledge_chunk_embeddings` table is left in place as a rollback safety net.

**Commit 3 — Cleanup.** After at least a week of stable operation, drop `knowledge_chunk_embeddings` table via Drizzle migration. Remove the import and any remaining references. Update `docs/changelog/`.

There is no feature flag and no runtime A/B between the two paths. At this scale the engineering cost of a flag exceeds its benefit; staged commits with the option to revert are sufficient.

### Configuration

Three new environment variables:

```
MILVUS_URI=https://in03-xxx.api.gcp-us-west1.zillizcloud.com
MILVUS_TOKEN=<api_key>
MILVUS_COLLECTION=knosi_knowledge_chunks
```

The collection name is configurable so dev and prod can be isolated against the same Zilliz cluster if desired (e.g. `knosi_knowledge_chunks_dev`). Default in code is `knosi_knowledge_chunks`.

`.env.example` gets the keys without values. The Hetzner deployment path (GitHub Actions secret → k3s secret manifest in `.github/workflows/deploy-hetzner.yml`) gets the same keys; deploy script changes are limited to passing the new env into the container.

Local dev hits Zilliz directly. Running milvus-lite locally is rejected for this iteration: the Python-embedded variant has no first-class Node SDK, the OSS Docker image needs ~2GB RAM the dev machine can spend better elsewhere, and the single-user/200-chunk workload is far below the latency threshold where local-first matters. The cost is that RAG queries fail offline; that is an acceptable tradeoff for a knowledge-base app where the dev path is mostly editor work, not retrieval.

### Startup behavior

When `MILVUS_URI` is set, the application calls `vectorStore.ensureCollection()` once during boot, before HTTP listeners come up. The check is idempotent — it inspects whether the collection exists and creates it (with the schema and HNSW index) only if missing. If the call fails (e.g. wrong credentials, Zilliz down), the application crashes immediately. This is deliberate: a misconfigured vector store is a configuration bug, not a runtime degradation. Letting the app come up in a broken state would mask the problem and produce silently-empty ANN results. The k3s liveness probe handles restart.

When `MILVUS_URI` is unset (E2E test env, local dev opting out), `getVectorStore()` returns null and `ensureCollection` is never called. The retrieval path checks for null and skips the ANN step, falling back to BM25-only. This matches the existing `EMBEDDING_PROVIDER=none` pattern.

### Failure modes

| Failure | Behavior | Recovery |
|---|---|---|
| Milvus unreachable at startup | App crash, k3s restart loop | Fix env vars or wait for Zilliz uptime |
| Milvus unreachable during indexer write | Index job marked failed | Existing retry mechanism re-runs the job |
| Milvus unreachable during search | ANN path returns empty; RRF degrades to BM25-only | Visible in eval harness; recovers when Milvus returns |
| Milvus delete fails on note removal | Orphan vectors in Milvus | Run `backfill-milvus.mjs --rebuild` |
| Embedding model dimension changes | Insert fails with dim mismatch | Create new collection with new dim, dual-write, repoint |

The "search returns empty" case is worth dwelling on. The current code wraps the embedding step in a `.catch()` and falls back to BM25-only — that pattern is preserved in the new code. So a Milvus outage during a query produces a degraded but non-empty answer, which is the right default for a knowledge-base UX.

## Eval Harness

The eval harness is the most important learning artifact of this migration. It outlives the migration itself and gets reused for the agentic RAG work in the next spec.

### Files

- `eval/ground-truth.json` — hand-curated query → relevant chunkIds pairs.
- `scripts/eval-rag.mjs` — runner.
- `eval/results/<timestamp>.json` — per-run output, gitignored.

### Ground truth schema

```json
{
  "queries": [
    {
      "id": "q-001",
      "query": "我之前怎么配 Tiptap 编辑器粘贴 Markdown 表格的？",
      "relevant_chunk_ids": ["abc123", "def456"],
      "notes": "should match the markdown-table-paste change"
    }
  ]
}
```

The owner hand-labels 5-10 queries against existing notes after the migration is up. The script ships with a `--seed-template` mode that lists the user's notes and recent chunks as candidates so labeling is fast.

### Runner behavior

```
node scripts/eval-rag.mjs [--ef N] [--top-k N] [--out path]
```

For each ground-truth query, the runner:

1. Calls `retrieveAgenticContext(query, { userId })` (the production code path).
2. Records the returned chunkIds in rank order.
3. Computes:
   - **recall@5** — fraction of `relevant_chunk_ids` present in top-5.
   - **recall@10** — same, top-10.
   - **MRR** — reciprocal of the rank of the first relevant chunk (0 if none).
4. Aggregates across queries (mean), prints a per-query breakdown.

The `--ef` flag overrides the search-time ef parameter via a temporary process env var that `vector-store.ts` reads. This is the primary tuning knob: rerun the harness with `--ef=32`, `--ef=64`, `--ef=128` and compare. The expected curve is recall improving and latency increasing as ef rises; the goal is to find the elbow.

### Sample output

```
Eval run @ 2026-04-27T03:14:00Z (ef=64, top-k=16)

Query                              Recall@5  Recall@10  MRR     Latency
q-001 markdown table paste            1.000      1.000  1.000     412ms
q-002 daemon login flow               0.667      1.000  0.500     389ms
q-003 hetzner deploy script           0.500      0.750  0.333     401ms
...

Aggregate (n=8):
  Recall@5  : 0.708
  Recall@10 : 0.875
  MRR       : 0.583
  p50 latency: 398ms
  p95 latency: 467ms
```

The format is line-oriented and grep-friendly so the owner can pipe runs through `tee eval/results/$(date +%s).json` and diff successive runs.

## Testing

### Unit tests

`src/server/ai/vector-store.test.mjs` exercises the abstraction with a fake `MilvusClient` injected via a test-only setter. Cases:

- `upsertChunkVectors` batches input over 100 records correctly.
- `searchSimilar` builds the correct `expr` string for various scope combinations.
- Filter quoting handles `user_id` containing quotes and backslashes (defense in depth).
- `deleteBySource` issues exactly one delete with the correct filter.

### Integration test

`scripts/eval-rag.mjs` itself is the integration test. The acceptance protocol is:

1. Before the migration starts, run the harness against the **current** SQLite-blob path with the labeled ground truth set. Record recall@5 / recall@10 / MRR as the baseline. Save to `eval/results/baseline-<timestamp>.json`.
2. After Commit 2 (read-side cutover), run the harness again. Save as `eval/results/post-milvus-<timestamp>.json`.
3. The migration is **accepted** if post-Milvus recall@10 is within ±0.05 of baseline (i.e. no material regression). It is **rejected** if recall drops materially below baseline — the most common cause would be a COSINE-vs-IP metric mismatch or wrong HNSW parameters, both of which the harness catches via per-query breakdown.

There is no absolute recall bar because we have no ground truth before this work; the bar is "don't make it worse." Once the labeled set is in place, future improvements (HNSW tuning, model upgrades, agentic RAG) can be measured against an absolute target.

### E2E

No E2E changes are needed. The Ask AI flows already covered by `e2e/` will continue to exercise `retrieveAgenticContext` indirectly. They are kept passing with `EMBEDDING_PROVIDER=none` (no embeddings, BM25-only) so they don't depend on the Milvus instance, matching the existing test pattern.

## Out of Scope

Documented here so they don't bleed into this PR:

- **Agentic RAG** — query rewrite, sub-query decomposition, iterative refinement, ReAct tool use. Separate spec; will be brainstormed after this one ships.
- **BM25 storage migration** — moving keyword search to SQLite FTS5. Independent optimization triggered by chunk count, not vector count.
- **Multi-tenant partitioning** — per-user Milvus partitions. Adds operational complexity without observable benefit at <10 users.
- **Embedding model upgrade** — switching from e5-small (384) to a larger model. Possible but coupled to evaluation outcomes from this work.
- **Cross-region latency optimization** — edge caching of query embeddings, regional Zilliz selection. Premature.

## Risks

1. **Zilliz free-tier pause.** Idle collections suspend; the first query after a pause may take several seconds. Acceptable for a personal tool; would not be acceptable in a paid product.
2. **Embedding model coupling.** The collection's vector dimension is fixed at 384. Switching models requires the migration plan in the failure-modes table.
3. **No transactional consistency.** Indexer writes are best-effort across two stores. The acceptance is documented; the eval harness will catch divergence.
4. **Network round-trip.** Hot-path latency increases by 50-200ms vs in-process dot product. At this scale, total Ask AI latency is dominated by LLM streaming, so this is invisible. At higher scale or for sub-second UX, revisit.

## Open Questions

None at spec time. All decisions above are committed unless the implementation surfaces a contradiction.
