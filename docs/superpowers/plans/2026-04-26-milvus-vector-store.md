# Milvus Vector Store Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-process SQLite blob + dot product semantic retrieval path with Zilliz Cloud Serverless (Milvus), preserving all current RAG behavior, adding an eval harness, and removing the legacy `knowledge_chunk_embeddings` table.

**Architecture:** A new `vector-store.ts` module is the only place that imports the Milvus SDK. The indexer dual-writes to Turso + Milvus during a transition window, then drops the SQLite write. Retrieval moves from in-memory dot product to Milvus HNSW search filtered by `user_id`. The migration ships in three reversible commits — write-side, read-side, cleanup — each verified by an eval harness that compares recall@k against a baseline captured before the migration begins.

**Tech Stack:**
- `@zilliz/milvus2-sdk-node` — Milvus Node.js client
- Existing: Drizzle ORM, libsql/Turso, MiniSearch, Transformers.js (`@huggingface/transformers`), node:test for unit tests
- Zilliz Cloud Serverless (free tier) — managed Milvus, no self-hosting

**Spec:** [docs/superpowers/specs/2026-04-26-milvus-vector-store-design.md](../specs/2026-04-26-milvus-vector-store-design.md)

---

## Prerequisites (manual, by user)

Before any task in this plan can run, the user must:

1. Sign up at https://cloud.zilliz.com/ (free tier, requires email + optional credit card for verification, no charge).
2. Create a serverless cluster in a region close to Hetzner Nuremberg (EU-Central preferred; US/Asia adds latency but works).
3. Generate an API key and copy:
   - The cluster URI (looks like `https://in03-xxx.api.gcp-us-west1.zillizcloud.com`)
   - The API token (starts with `db_`)
4. Save these values for use in Task 1.

These are one-time manual steps. The plan assumes they are done before Task 1.

---

## Task 1: Install SDK and configure environment

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `.env.local` entries (manual, not committed)

- [ ] **Step 1.1: Install the Milvus SDK**

The default npm registry on this machine is the Bytedance internal mirror (`bnpm.byted.org`); the Zilliz package is on the public registry. Switch registries for the install, then switch back:

```pwsh
npm config set registry https://registry.npmjs.org/
pnpm add @zilliz/milvus2-sdk-node@^2.5.0
npm config set registry https://bnpm.byted.org/
```

Expected: `package.json` gets a new entry under `dependencies`. `pnpm-lock.yaml` updated.

- [ ] **Step 1.2: Add env variable placeholders to `.env.example`**

Find the existing block in `.env.example` (likely near other AI provider keys) and append:

```bash
# Milvus / Zilliz Cloud — vector store for RAG semantic retrieval
# When unset, the application falls back to BM25-only retrieval (matches
# EMBEDDING_PROVIDER=none). Required in production.
MILVUS_URI=
MILVUS_TOKEN=
MILVUS_COLLECTION=knosi_knowledge_chunks
```

- [ ] **Step 1.3: Set the values in your local `.env.local`**

Open `.env.local` and add the three lines with the values from the Zilliz signup. Do NOT commit `.env.local`.

```bash
MILVUS_URI=https://in03-xxx.api.gcp-us-west1.zillizcloud.com
MILVUS_TOKEN=db_xxxxxxxxxxxxxxxxxxxx
MILVUS_COLLECTION=knosi_knowledge_chunks
```

- [ ] **Step 1.4: Verify connectivity with a one-off script**

Create `scripts/check-milvus.mjs` (this script is throwaway — delete after Task 1 completes):

```js
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const client = new MilvusClient({
  address: process.env.MILVUS_URI,
  token: process.env.MILVUS_TOKEN,
});

const result = await client.listCollections();
console.log("Collections:", result.data.map((c) => c.name));
console.log("Connection OK.");
```

Run:

```pwsh
node --env-file=.env.local scripts/check-milvus.mjs
```

Expected: `Collections: []` (or whatever exists), then `Connection OK.`. If you get an auth error, the token is wrong; if connection refused, the URI is wrong.

- [ ] **Step 1.5: Delete the throwaway script**

```pwsh
Remove-Item scripts/check-milvus.mjs
```

- [ ] **Step 1.6: Commit the SDK install and env example**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore(rag): add @zilliz/milvus2-sdk-node + env scaffolding"
```

---

## Task 2: Create vector-store.ts skeleton + types

**Files:**
- Create: `src/server/ai/vector-store.ts`
- Create: `src/server/ai/vector-store.test.mjs`

- [ ] **Step 2.1: Write a failing test for `getVectorStore` returning null when MILVUS_URI is unset**

Create `src/server/ai/vector-store.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import vectorStoreModule from "./vector-store.ts";

const { getVectorStore, __resetVectorStoreForTest } = vectorStoreModule;

test.afterEach(() => {
  __resetVectorStoreForTest();
  delete process.env.MILVUS_URI;
  delete process.env.MILVUS_TOKEN;
});

test("getVectorStore returns null when MILVUS_URI is unset", () => {
  delete process.env.MILVUS_URI;
  delete process.env.MILVUS_TOKEN;
  assert.equal(getVectorStore(), null);
});
```

- [ ] **Step 2.2: Run the test, verify it fails**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: FAIL with "Cannot find module './vector-store.ts'".

- [ ] **Step 2.3: Create the skeleton `vector-store.ts`**

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

let cachedStore: VectorStore | null | undefined;

/**
 * Lazy singleton. Returns null when MILVUS_URI is unset, mirroring the
 * embeddings.ts "provider mode = none" pattern. Callers must null-check.
 */
export function getVectorStore(): VectorStore | null {
  if (cachedStore !== undefined) return cachedStore;

  const uri = process.env.MILVUS_URI?.trim();
  const token = process.env.MILVUS_TOKEN?.trim();

  if (!uri || !token) {
    cachedStore = null;
    return null;
  }

  // Real implementation arrives in subsequent tasks; for now leave a stub
  // that preserves the type contract.
  cachedStore = createMilvusVectorStore({ uri, token });
  return cachedStore;
}

function createMilvusVectorStore(_opts: {
  uri: string;
  token: string;
}): VectorStore {
  throw new Error("createMilvusVectorStore not yet implemented");
}

export function __resetVectorStoreForTest() {
  cachedStore = undefined;
}

const vectorStoreModule = {
  getVectorStore,
  __resetVectorStoreForTest,
};

export default vectorStoreModule;
```

- [ ] **Step 2.4: Run the test, verify it passes**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: PASS.

- [ ] **Step 2.5: Run typecheck to ensure types compile**

```pwsh
pnpm build
```

Expected: build succeeds. If TS complains about `--experimental-strip-types`, add the test file path to whatever .test.mjs exclusion list exists in `tsconfig.json` — the existing `.test.mjs` files in the repo all use this loader pattern, so check `src/server/ai/daemon-chat-events.test.mjs` for the working setup.

- [ ] **Step 2.6: Commit**

```bash
git add src/server/ai/vector-store.ts src/server/ai/vector-store.test.mjs
git commit -m "feat(rag): vector-store.ts skeleton with types and lazy singleton"
```

---

## Task 3: Implement `ensureCollection`

**Files:**
- Modify: `src/server/ai/vector-store.ts`
- Modify: `src/server/ai/vector-store.test.mjs`

- [ ] **Step 3.1: Add a failing test for ensureCollection idempotency**

Append to `vector-store.test.mjs`:

```js
test("ensureCollection is idempotent — second call is a no-op when collection exists", async () => {
  let createCalls = 0;
  let createIndexCalls = 0;
  let hasCollectionCalls = 0;

  const fakeClient = {
    hasCollection: async () => {
      hasCollectionCalls++;
      // Return false on first call, true thereafter
      return { value: hasCollectionCalls > 1 };
    },
    createCollection: async () => {
      createCalls++;
      return { error_code: "Success" };
    },
    createIndex: async () => {
      createIndexCalls++;
      return { error_code: "Success" };
    },
    loadCollection: async () => ({ error_code: "Success" }),
  };

  const { __setMilvusClientForTest } = vectorStoreModule;
  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  __setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  assert.ok(store);

  await store.ensureCollection();
  await store.ensureCollection();

  assert.equal(createCalls, 1, "createCollection should run exactly once");
  assert.equal(createIndexCalls, 1, "createIndex should run exactly once");
});
```

- [ ] **Step 3.2: Run test, verify it fails**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: FAIL — `__setMilvusClientForTest` undefined or `ensureCollection` not implemented.

- [ ] **Step 3.3: Implement `ensureCollection`**

Replace the stub `createMilvusVectorStore` in `src/server/ai/vector-store.ts` with the real implementation (and add the test setter). Replace these sections:

```ts
import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";

const COLLECTION_NAME =
  process.env.MILVUS_COLLECTION?.trim() || "knosi_knowledge_chunks";
const VECTOR_DIM = 384; // multilingual-e5-small

let testClient: MilvusClient | null = null;

export function __setMilvusClientForTest(client: MilvusClient | null) {
  testClient = client;
  cachedStore = undefined;
}

function createMilvusVectorStore(opts: {
  uri: string;
  token: string;
}): VectorStore {
  const client =
    testClient ??
    new MilvusClient({
      address: opts.uri,
      token: opts.token,
    });

  let ensured = false;

  async function ensureCollection() {
    if (ensured) return;

    const exists = await client.hasCollection({
      collection_name: COLLECTION_NAME,
    });
    if (!exists.value) {
      await client.createCollection({
        collection_name: COLLECTION_NAME,
        fields: [
          {
            name: "chunk_id",
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 64,
          },
          {
            name: "vector",
            data_type: DataType.FloatVector,
            dim: VECTOR_DIM,
          },
          {
            name: "user_id",
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: "source_type",
            data_type: DataType.VarChar,
            max_length: 8,
          },
          {
            name: "source_id",
            data_type: DataType.VarChar,
            max_length: 64,
          },
        ],
      });
      await client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: "vector",
        index_type: "HNSW",
        metric_type: "COSINE",
        params: { M: 16, efConstruction: 200 },
      });
    }
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    ensured = true;
  }

  return {
    ensureCollection,
    async upsertChunkVectors(_records) {
      throw new Error("upsertChunkVectors not yet implemented");
    },
    async existsByChunkIds(_chunkIds) {
      throw new Error("existsByChunkIds not yet implemented");
    },
    async searchSimilar(_opts) {
      throw new Error("searchSimilar not yet implemented");
    },
    async deleteByChunkIds(_chunkIds) {
      throw new Error("deleteByChunkIds not yet implemented");
    },
    async deleteBySource(_sourceId) {
      throw new Error("deleteBySource not yet implemented");
    },
  };
}
```

Update the default export to include `__setMilvusClientForTest`:

```ts
const vectorStoreModule = {
  getVectorStore,
  __resetVectorStoreForTest,
  __setMilvusClientForTest,
};
```

- [ ] **Step 3.4: Run test, verify it passes**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/server/ai/vector-store.ts src/server/ai/vector-store.test.mjs
git commit -m "feat(rag): implement vectorStore.ensureCollection (HNSW/COSINE on 384-dim)"
```

---

## Task 4: Implement `upsertChunkVectors` with batching

**Files:**
- Modify: `src/server/ai/vector-store.ts`
- Modify: `src/server/ai/vector-store.test.mjs`

- [ ] **Step 4.1: Write failing test for batching**

Append to `vector-store.test.mjs`:

```js
test("upsertChunkVectors batches input over 100 records per request", async () => {
  const upsertCalls = [];

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    createCollection: async () => ({ error_code: "Success" }),
    createIndex: async () => ({ error_code: "Success" }),
    loadCollection: async () => ({ error_code: "Success" }),
    upsert: async ({ data }) => {
      upsertCalls.push(data.length);
      return { error_code: "Success" };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  assert.ok(store);

  const records = Array.from({ length: 250 }, (_, i) => ({
    chunkId: `chunk-${i}`,
    userId: "user-1",
    sourceType: "note",
    sourceId: "src-1",
    vector: new Array(384).fill(0.1),
  }));

  await store.upsertChunkVectors(records);

  assert.deepEqual(upsertCalls, [100, 100, 50]);
});
```

- [ ] **Step 4.2: Run test, verify it fails**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: FAIL with "upsertChunkVectors not yet implemented".

- [ ] **Step 4.3: Implement upsertChunkVectors**

In `vector-store.ts`, replace the `upsertChunkVectors` stub:

```ts
async upsertChunkVectors(records) {
  if (records.length === 0) return;
  await ensureCollection();

  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const result = await client.upsert({
      collection_name: COLLECTION_NAME,
      data: batch.map((r) => ({
        chunk_id: r.chunkId,
        vector: r.vector,
        user_id: r.userId,
        source_type: r.sourceType,
        source_id: r.sourceId,
      })),
    });
    if (result.status?.error_code && result.status.error_code !== "Success") {
      throw new Error(
        `Milvus upsert failed: ${result.status.error_code} ${result.status.reason ?? ""}`
      );
    }
  }
},
```

- [ ] **Step 4.4: Run test, verify it passes**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/server/ai/vector-store.ts src/server/ai/vector-store.test.mjs
git commit -m "feat(rag): vectorStore.upsertChunkVectors with 100-batch chunking"
```

---

## Task 5: Implement `searchSimilar` with expr building

**Files:**
- Modify: `src/server/ai/vector-store.ts`
- Modify: `src/server/ai/vector-store.test.mjs`

- [ ] **Step 5.1: Write failing test for expr building (user_id only)**

Append to `vector-store.test.mjs`:

```js
test("searchSimilar builds correct expr for user_id filter only", async () => {
  let capturedFilter = null;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    search: async ({ filter }) => {
      capturedFilter = filter;
      return {
        results: [
          { chunk_id: "c1", score: 0.95 },
          { chunk_id: "c2", score: 0.87 },
        ],
      };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  assert.ok(store);

  const results = await store.searchSimilar({
    userId: "user-abc",
    queryVector: new Array(384).fill(0.1),
    topK: 10,
  });

  assert.equal(capturedFilter, 'user_id == "user-abc"');
  assert.deepEqual(results, [
    { chunkId: "c1", score: 0.95 },
    { chunkId: "c2", score: 0.87 },
  ]);
});
```

- [ ] **Step 5.2: Write failing test for expr with sourceTypes**

Append:

```js
test("searchSimilar builds expr including source_types when provided", async () => {
  let capturedFilter = null;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    search: async ({ filter }) => {
      capturedFilter = filter;
      return { results: [] };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  await store.searchSimilar({
    userId: "user-1",
    queryVector: new Array(384).fill(0),
    topK: 5,
    sourceTypes: ["note"],
  });

  assert.equal(
    capturedFilter,
    'user_id == "user-1" && source_type in ["note"]'
  );
});
```

- [ ] **Step 5.3: Write failing test for expr quoting (defense in depth)**

Append:

```js
test("searchSimilar safely quotes user_id values containing special chars", async () => {
  let capturedFilter = null;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    search: async ({ filter }) => {
      capturedFilter = filter;
      return { results: [] };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  await store.searchSimilar({
    userId: 'evil"; drop --',
    queryVector: new Array(384).fill(0),
    topK: 5,
  });

  // Quote and backslash should be escaped
  assert.equal(capturedFilter, 'user_id == "evil\\"; drop --"');
});
```

- [ ] **Step 5.4: Run tests, verify they fail**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: 3 new tests FAIL with "searchSimilar not yet implemented".

- [ ] **Step 5.5: Implement searchSimilar**

In `vector-store.ts`, add a helper at module scope:

```ts
function escapeMilvusString(value: string): string {
  // Milvus expression strings are double-quoted. Escape backslashes and
  // double quotes; reject newlines/null bytes outright.
  if (/[ \n\r]/.test(value)) {
    throw new Error("Milvus filter value contains forbidden control character");
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSearchFilter(opts: {
  userId: string;
  sourceTypes?: ("note" | "bookmark")[];
}): string {
  const parts = [`user_id == "${escapeMilvusString(opts.userId)}"`];
  if (opts.sourceTypes && opts.sourceTypes.length > 0) {
    const list = opts.sourceTypes
      .map((t) => `"${escapeMilvusString(t)}"`)
      .join(", ");
    parts.push(`source_type in [${list}]`);
  }
  return parts.join(" && ");
}
```

Replace the `searchSimilar` stub:

```ts
async searchSimilar(opts) {
  await ensureCollection();
  const filter = buildSearchFilter({
    userId: opts.userId,
    sourceTypes: opts.sourceTypes,
  });
  const result = await client.search({
    collection_name: COLLECTION_NAME,
    data: [opts.queryVector],
    limit: opts.topK,
    filter,
    output_fields: ["chunk_id"],
    params: { ef: Number(process.env.MILVUS_SEARCH_EF) || 64 },
  });
  return (result.results ?? []).map((row) => ({
    chunkId: row.chunk_id ?? row.id ?? "",
    score: row.score ?? 0,
  }));
},
```

- [ ] **Step 5.6: Run tests, verify all pass**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5.7: Commit**

```bash
git add src/server/ai/vector-store.ts src/server/ai/vector-store.test.mjs
git commit -m "feat(rag): vectorStore.searchSimilar with safe expr building"
```

---

## Task 6: Implement `existsByChunkIds`, `deleteByChunkIds`, `deleteBySource`

**Files:**
- Modify: `src/server/ai/vector-store.ts`
- Modify: `src/server/ai/vector-store.test.mjs`

- [ ] **Step 6.1: Write failing test for existsByChunkIds**

Append:

```js
test("existsByChunkIds returns the set of chunkIds that exist in Milvus", async () => {
  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    query: async ({ filter, output_fields }) => {
      assert.equal(output_fields[0], "chunk_id");
      assert.match(filter, /chunk_id in \[/);
      return {
        data: [{ chunk_id: "c1" }, { chunk_id: "c3" }],
      };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  const result = await store.existsByChunkIds(["c1", "c2", "c3"]);

  assert.deepEqual([...result].sort(), ["c1", "c3"]);
});
```

- [ ] **Step 6.2: Write failing test for deleteByChunkIds**

Append:

```js
test("deleteByChunkIds builds correct in-list filter", async () => {
  let capturedFilter = null;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    deleteEntities: async ({ filter }) => {
      capturedFilter = filter;
      return { status: { error_code: "Success" } };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  await store.deleteByChunkIds(["a", "b", "c"]);

  assert.equal(capturedFilter, 'chunk_id in ["a", "b", "c"]');
});

test("deleteByChunkIds is a no-op for empty list", async () => {
  let deleteCalls = 0;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    deleteEntities: async () => {
      deleteCalls++;
      return { status: { error_code: "Success" } };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  await store.deleteByChunkIds([]);

  assert.equal(deleteCalls, 0);
});
```

- [ ] **Step 6.3: Write failing test for deleteBySource**

Append:

```js
test("deleteBySource builds correct source_id filter", async () => {
  let capturedFilter = null;

  const fakeClient = {
    hasCollection: async () => ({ value: true }),
    loadCollection: async () => ({ error_code: "Success" }),
    deleteEntities: async ({ filter }) => {
      capturedFilter = filter;
      return { status: { error_code: "Success" } };
    },
  };

  process.env.MILVUS_URI = "https://test";
  process.env.MILVUS_TOKEN = "test-token";
  vectorStoreModule.__setMilvusClientForTest(fakeClient);

  const store = getVectorStore();
  await store.deleteBySource("source-123");

  assert.equal(capturedFilter, 'source_id == "source-123"');
});
```

- [ ] **Step 6.4: Run tests, verify they fail**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: 4 new tests FAIL.

- [ ] **Step 6.5: Implement the three methods**

In `vector-store.ts`, replace the three stubs:

```ts
async existsByChunkIds(chunkIds) {
  if (chunkIds.length === 0) return new Set();
  await ensureCollection();
  const list = chunkIds.map((id) => `"${escapeMilvusString(id)}"`).join(", ");
  const result = await client.query({
    collection_name: COLLECTION_NAME,
    filter: `chunk_id in [${list}]`,
    output_fields: ["chunk_id"],
    limit: chunkIds.length,
  });
  return new Set((result.data ?? []).map((row) => String(row.chunk_id)));
},

async deleteByChunkIds(chunkIds) {
  if (chunkIds.length === 0) return;
  await ensureCollection();
  const list = chunkIds.map((id) => `"${escapeMilvusString(id)}"`).join(", ");
  const result = await client.deleteEntities({
    collection_name: COLLECTION_NAME,
    filter: `chunk_id in [${list}]`,
  });
  if (result.status?.error_code && result.status.error_code !== "Success") {
    throw new Error(
      `Milvus delete failed: ${result.status.error_code} ${result.status.reason ?? ""}`
    );
  }
},

async deleteBySource(sourceId) {
  await ensureCollection();
  const result = await client.deleteEntities({
    collection_name: COLLECTION_NAME,
    filter: `source_id == "${escapeMilvusString(sourceId)}"`,
  });
  if (result.status?.error_code && result.status.error_code !== "Success") {
    throw new Error(
      `Milvus delete failed: ${result.status.error_code} ${result.status.reason ?? ""}`
    );
  }
},
```

- [ ] **Step 6.6: Run tests, verify all pass**

```pwsh
node --test --experimental-strip-types src/server/ai/vector-store.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6.7: Commit**

```bash
git add src/server/ai/vector-store.ts src/server/ai/vector-store.test.mjs
git commit -m "feat(rag): vectorStore exists/delete operations with safe filters"
```

---

## Task 7: Wire `ensureCollection` into application startup

**Files:**
- Modify: `src/instrumentation.ts`

- [ ] **Step 7.1: Modify `register()` to also ensure the Milvus collection**

In `src/instrumentation.ts`, replace the body of `register` so that after the tracing block, it also runs `vectorStore.ensureCollection()`:

```ts
import { logger } from "./server/logger";
import { getVectorStore } from "./server/ai/vector-store";

type RegisterDeps = {
  env?: NodeJS.ProcessEnv;
  installNodeTracing?: () => Promise<void> | void;
};

let tracingInstalled = false;
let vectorStoreEnsured = false;

export function hasTracingConfig(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

async function installNodeTracingFromEnv(env: NodeJS.ProcessEnv) {
  // ... unchanged ...
}

async function ensureVectorStoreOnce() {
  if (vectorStoreEnsured) return;
  const store = getVectorStore();
  if (!store) return; // MILVUS_URI unset — graceful skip
  await store.ensureCollection();
  vectorStoreEnsured = true;
}

export async function register(deps: RegisterDeps = {}) {
  const env = deps.env ?? process.env;
  if (env.NEXT_RUNTIME === "edge") return;

  // Tracing is optional
  if (hasTracingConfig(env) && !tracingInstalled) {
    const installNodeTracing =
      deps.installNodeTracing ?? (() => installNodeTracingFromEnv(env));
    try {
      await installNodeTracing();
      tracingInstalled = true;
    } catch (err) {
      logger.error(
        { event: "tracing.install_error", err },
        "failed to install node tracing"
      );
    }
  }

  // Vector store is required when MILVUS_URI is set; failure is fail-fast.
  await ensureVectorStoreOnce();
}

const instrumentation = {
  hasTracingConfig,
  register,
};

export default instrumentation;
```

Note: keep the existing `installNodeTracingFromEnv` body (do not delete those lines, only the surrounding `register` body changed).

- [ ] **Step 7.2: Verify `pnpm build` still passes**

```pwsh
pnpm build
```

Expected: build succeeds. The dynamic import of vector-store happens at module load via `getVectorStore`, but ensure no circular import issues.

- [ ] **Step 7.3: Verify dev server starts**

```pwsh
pnpm dev
```

Expected: server starts on port 3200. Console shows no Milvus errors. If `MILVUS_URI` is set in `.env.local`, look for a successful collection load (silent — only errors are logged). If it crashes here, the credentials are wrong; fix and retry.

Stop the dev server (Ctrl+C) once verified.

- [ ] **Step 7.4: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat(rag): ensure milvus collection at app startup (fail-fast)"
```

---

## Task 8: Eval ground truth template + harness script

**Files:**
- Create: `eval/ground-truth.json`
- Create: `scripts/eval-rag.mjs`
- Modify: `.gitignore`

- [ ] **Step 8.1: Create eval directory and gitignore the results subdirectory**

```pwsh
New-Item -ItemType Directory -Path eval/results -Force
```

Append to `.gitignore`:

```
# Eval harness — keep ground-truth.json, ignore raw runs
/eval/results/
/scripts/.backfill-milvus-failed.json
```

- [ ] **Step 8.2: Create `eval/ground-truth.json` with 3 starter queries**

The user will edit this after the harness is in place — write a runnable starter file with comments via JSON comments-as-fields:

```json
{
  "_doc": "Each entry: id, query (Chinese or English), relevant_chunk_ids (filled by user). Query is fed verbatim to retrieveAgenticContext. Run scripts/eval-rag.mjs --seed-template to list candidate chunkIds for each query.",
  "queries": [
    {
      "id": "q-001",
      "query": "我之前怎么配 Tiptap 编辑器粘贴 Markdown 表格的？",
      "relevant_chunk_ids": [],
      "notes": "edit relevant_chunk_ids manually after running --seed-template"
    },
    {
      "id": "q-002",
      "query": "Hetzner 部署脚本是怎么走的？",
      "relevant_chunk_ids": [],
      "notes": ""
    },
    {
      "id": "q-003",
      "query": "knosi cli daemon 启动时找 claude 二进制的逻辑",
      "relevant_chunk_ids": [],
      "notes": ""
    }
  ]
}
```

- [ ] **Step 8.3: Create `scripts/eval-rag.mjs`**

```js
#!/usr/bin/env node
// Eval harness for the RAG retrieval pipeline.
// Usage:
//   node --env-file=.env.local scripts/eval-rag.mjs
//   node --env-file=.env.local scripts/eval-rag.mjs --ef 32
//   node --env-file=.env.local scripts/eval-rag.mjs --seed-template

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const SEED_MODE = args.includes("--seed-template");
const EF = getArg("--ef", null);
const TOP_K = Number(getArg("--top-k", 16));
const OUT_PATH = getArg("--out", null);

if (EF) process.env.MILVUS_SEARCH_EF = EF;

// userId: in single-user dev, pass via env or hardcode here.
const USER_ID = process.env.EVAL_USER_ID;
if (!USER_ID && !SEED_MODE) {
  console.error("Set EVAL_USER_ID in env (your user id from the users table).");
  process.exit(1);
}

const groundTruthPath = resolve("eval/ground-truth.json");
const groundTruth = JSON.parse(await readFile(groundTruthPath, "utf8"));

if (SEED_MODE) {
  // Print recent chunks per query (rough — uses BM25 only) so the user
  // can fill relevant_chunk_ids by hand.
  const { retrieveAgenticContext } = await import(
    "../src/server/ai/agentic-rag.ts"
  );
  for (const q of groundTruth.queries) {
    console.log(`\n=== ${q.id}: ${q.query} ===`);
    const results = await retrieveAgenticContext(q.query, {
      userId: USER_ID ?? "REPLACE_WITH_YOUR_USER_ID",
    });
    for (const r of results.slice(0, 10)) {
      const preview = r.content.replace(/\s+/g, " ").slice(0, 80);
      console.log(`  ${r.chunkId}  ${r.sourceTitle}  | ${preview}`);
    }
  }
  process.exit(0);
}

const { retrieveAgenticContext } = await import(
  "../src/server/ai/agentic-rag.ts"
);

const perQuery = [];
for (const q of groundTruth.queries) {
  if (q.relevant_chunk_ids.length === 0) {
    console.warn(`[skip] ${q.id} has no relevant_chunk_ids labeled`);
    continue;
  }

  const t0 = Date.now();
  const results = await retrieveAgenticContext(q.query, { userId: USER_ID });
  const latencyMs = Date.now() - t0;

  const ranked = results.map((r) => r.chunkId);
  const relevant = new Set(q.relevant_chunk_ids);

  const top5 = ranked.slice(0, 5);
  const top10 = ranked.slice(0, TOP_K > 10 ? 10 : TOP_K);

  const recall5 =
    [...relevant].filter((id) => top5.includes(id)).length / relevant.size;
  const recall10 =
    [...relevant].filter((id) => top10.includes(id)).length / relevant.size;
  const firstRelevantIndex = ranked.findIndex((id) => relevant.has(id));
  const mrr = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;

  perQuery.push({
    id: q.id,
    query: q.query,
    recall5,
    recall10,
    mrr,
    latencyMs,
    rankedTopK: ranked.slice(0, TOP_K),
  });
}

if (perQuery.length === 0) {
  console.error("No labeled queries to evaluate. Run --seed-template first.");
  process.exit(1);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const aggregate = {
  n: perQuery.length,
  recall5: mean(perQuery.map((q) => q.recall5)),
  recall10: mean(perQuery.map((q) => q.recall10)),
  mrr: mean(perQuery.map((q) => q.mrr)),
  p50LatencyMs: [...perQuery.map((q) => q.latencyMs)].sort((a, b) => a - b)[
    Math.floor(perQuery.length / 2)
  ],
};

console.log(
  `\nEval run @ ${new Date().toISOString()} (ef=${EF ?? "default"}, top-k=${TOP_K})`
);
console.log("\nQuery                            Recall@5  Recall@10  MRR     Latency");
for (const r of perQuery) {
  const id = r.id.padEnd(8);
  const q = r.query.slice(0, 24).padEnd(24);
  console.log(
    `${id} ${q}    ${r.recall5.toFixed(3)}     ${r.recall10.toFixed(3)}   ${r.mrr.toFixed(3)}   ${r.latencyMs}ms`
  );
}
console.log("\nAggregate:");
console.log(`  Recall@5     : ${aggregate.recall5.toFixed(3)}`);
console.log(`  Recall@10    : ${aggregate.recall10.toFixed(3)}`);
console.log(`  MRR          : ${aggregate.mrr.toFixed(3)}`);
console.log(`  p50 latency  : ${aggregate.p50LatencyMs}ms`);

const outPath =
  OUT_PATH ??
  resolve(`eval/results/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await mkdir(resolve("eval/results"), { recursive: true });
await writeFile(outPath, JSON.stringify({ aggregate, perQuery }, null, 2));
console.log(`\nSaved to ${outPath}`);
```

- [ ] **Step 8.4: Make the script executable and verify it runs**

The script imports `agentic-rag.ts` directly. Use Node's experimental TS strip:

```pwsh
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --seed-template
```

Expected: prints candidate chunkIds for each query.

If you get an error about `--experimental-strip-types`, the agentic-rag.ts import path may need adjustment. Verify by running `node --version` — you need Node 22.6+. The CLI daemon already requires Node 20+; bump to 22 if needed.

- [ ] **Step 8.5: User: fill `eval/ground-truth.json` with real labels**

This is a manual step. The user looks at `--seed-template` output, picks the 1-3 chunkIds per query that should be returned (based on memory of the labeled note content), and edits `relevant_chunk_ids` arrays.

Expected: each query has at least 1 chunkId labeled. If a query genuinely has no relevant chunk in the corpus, delete it from the file.

- [ ] **Step 8.6: Capture the BASELINE eval (before any retrieval changes)**

```pwsh
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --out eval/results/baseline.json
```

Expected: prints recall@5 / recall@10 / MRR. The output file `eval/results/baseline.json` is the reference for the post-Milvus comparison in Task 11.

- [ ] **Step 8.7: Commit eval scaffolding (without results)**

```bash
git add .gitignore eval/ground-truth.json scripts/eval-rag.mjs
git commit -m "feat(rag): eval harness with ground truth and recall@k metrics"
```

---

## Task 9: Modify indexer for dual-write (Commit 1 — write side)

**Files:**
- Modify: `src/server/ai/indexer.ts`

- [ ] **Step 9.1: Add Milvus dual-write to `syncSourceIndex`**

In `src/server/ai/indexer.ts`, modify the section around line 250-258 where embeddings are inserted. Keep the SQLite insert for now (this is the write-side commit; the read still uses SQLite). After the SQLite insert, add a Milvus upsert:

```ts
import { getVectorStore } from "./vector-store";

// ... existing imports unchanged ...

// Inside syncSourceIndex, after the existing block:
//   if (embedded) {
//     await db.insert(knowledgeChunkEmbeddings).values( ... );
//   }
// add:

if (embedded) {
  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.upsertChunkVectors(
      embedded.vectors.map((vector, index) => ({
        chunkId: insertedChunks[index].id,
        userId,
        sourceType,
        sourceId,
        vector,
      }))
    );
  }
}
```

- [ ] **Step 9.2: Add Milvus delete to `deleteChunkRows`**

In the same file, modify `deleteChunkRows` (around line 78). After the `db.delete(knowledgeChunkEmbeddings)` call, add a Milvus delete:

```ts
async function deleteChunkRows(sourceType: KnowledgeSourceType, sourceId: string) {
  const existingChunkRows = await db
    .select({ id: knowledgeChunks.id })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId)
      )
    );

  const chunkIds = existingChunkRows.map((row) => row.id);

  if (chunkIds.length > 0) {
    await db
      .delete(knowledgeChunkEmbeddings)
      .where(inArray(knowledgeChunkEmbeddings.chunkId, chunkIds));

    const vectorStore = getVectorStore();
    if (vectorStore) {
      await vectorStore.deleteByChunkIds(chunkIds);
    }
  }

  await db
    .delete(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId)
      )
    );
}
```

- [ ] **Step 9.3: Add Milvus dual-write to `fillMissingEmbeddingsForExistingChunks`**

After the existing `db.insert(knowledgeChunkEmbeddings).values(...)` call (around line 132), add the Milvus upsert. The full function becomes:

```ts
async function fillMissingEmbeddingsForExistingChunks(
  existing: ExistingChunkRow[]
) {
  if (existing.length === 0) return;

  const existingIds = existing.map((chunk) => chunk.id);
  const embeddedRows = await db
    .select({ chunkId: knowledgeChunkEmbeddings.chunkId })
    .from(knowledgeChunkEmbeddings)
    .where(inArray(knowledgeChunkEmbeddings.chunkId, existingIds));

  const embeddedSet = new Set(embeddedRows.map((row) => row.chunkId));
  const missing = existing.filter((chunk) => !embeddedSet.has(chunk.id));
  if (missing.length === 0) return;

  const embedded = await embedTexts(missing.map((chunk) => chunk.text));
  if (!embedded) return;

  await db.insert(knowledgeChunkEmbeddings).values(
    embedded.vectors.map((vector, index) => ({
      chunkId: missing[index]!.id,
      model: embedded.model,
      dims: vector.length,
      vector: vectorArrayToBuffer(vector),
    }))
  );

  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.upsertChunkVectors(
      embedded.vectors.map((vector, index) => ({
        chunkId: missing[index]!.id,
        userId: missing[index]!.userId ?? "",
        sourceType: missing[index]!.sourceType,
        sourceId: missing[index]!.sourceId,
        vector,
      }))
    );
  }
}
```

(`userId` may be null on legacy chunks — see schema. The empty-string fallback is intentional; those rows will be invisible to user-scoped Milvus searches, which is the correct behavior.)

- [ ] **Step 9.4: Verify build + lint**

```pwsh
pnpm build
pnpm exec eslint src/server/ai/indexer.ts
```

Expected: build passes, no lint errors.

- [ ] **Step 9.5: Verify by editing a note and observing Milvus**

```pwsh
pnpm dev
```

In the browser, edit any existing note (add/remove a sentence). Then run:

```pwsh
node --env-file=.env.local -e "
import('@zilliz/milvus2-sdk-node').then(async ({ MilvusClient }) => {
  const c = new MilvusClient({ address: process.env.MILVUS_URI, token: process.env.MILVUS_TOKEN });
  const r = await c.query({ collection_name: 'knosi_knowledge_chunks', filter: 'chunk_id != \"\"', output_fields: ['chunk_id'], limit: 5 });
  console.log('Sample rows:', r.data);
});
"
```

Expected: 5 chunk_id rows returned. Stop dev (Ctrl+C).

- [ ] **Step 9.6: Commit**

```bash
git add src/server/ai/indexer.ts
git commit -m "feat(rag): dual-write embeddings to Milvus alongside SQLite (commit 1/3)"
```

---

## Task 10: Backfill existing chunks into Milvus

**Files:**
- Create: `scripts/backfill-milvus.mjs`

- [ ] **Step 10.1: Create the backfill script**

```js
#!/usr/bin/env node
// Backfill: copy existing knowledge_chunk_embeddings rows into Milvus.
// Usage:
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-milvus.mjs
//   node ... scripts/backfill-milvus.mjs --rebuild   # drop + recreate collection
//   node ... scripts/backfill-milvus.mjs --resume    # only retry rows in .backfill-milvus-failed.json

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const REBUILD = args.includes("--rebuild");
const RESUME = args.includes("--resume");

const { MilvusClient } = await import("@zilliz/milvus2-sdk-node");
const { db } = await import("../src/server/db/index.ts");
const { knowledgeChunks, knowledgeChunkEmbeddings } = await import(
  "../src/server/db/schema/index.ts"
);
const { vectorBufferToArray } = await import("../src/server/ai/embeddings.ts");
const { getVectorStore } = await import("../src/server/ai/vector-store.ts");
const { eq } = await import("drizzle-orm");

const FAILED_PATH = resolve(".backfill-milvus-failed.json");
const PAGE_SIZE = 200;
const BATCH_SIZE = 100;

const collectionName =
  process.env.MILVUS_COLLECTION || "knosi_knowledge_chunks";
const milvusClient = new MilvusClient({
  address: process.env.MILVUS_URI,
  token: process.env.MILVUS_TOKEN,
});

if (REBUILD) {
  console.log(`[backfill] dropping collection ${collectionName}`);
  await milvusClient.dropCollection({ collection_name: collectionName });
}

const store = getVectorStore();
if (!store) {
  console.error("MILVUS_URI not set");
  process.exit(1);
}
await store.ensureCollection();

let resumeIds = null;
if (RESUME) {
  try {
    resumeIds = new Set(JSON.parse(await readFile(FAILED_PATH, "utf8")));
    console.log(`[backfill] resume: ${resumeIds.size} chunkIds`);
  } catch {
    console.error("No resume file found.");
    process.exit(1);
  }
}

// Page through rows. Fetch chunks JOIN embeddings.
let offset = 0;
const failed = [];
let totalSeen = 0;
let totalUpserted = 0;

while (true) {
  // Read embedding rows
  const embeddingRows = await db
    .select()
    .from(knowledgeChunkEmbeddings)
    .limit(PAGE_SIZE)
    .offset(offset);

  if (embeddingRows.length === 0) break;
  totalSeen += embeddingRows.length;

  // Lookup matching chunk metadata
  const chunkIds = embeddingRows.map((r) => r.chunkId);
  const chunkRows = await db
    .select()
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.id, chunkIds[0]));
  const chunkMap = new Map();
  for (const id of chunkIds) {
    const [chunk] = await db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.id, id));
    if (chunk) chunkMap.set(id, chunk);
  }

  const records = [];
  for (const row of embeddingRows) {
    if (resumeIds && !resumeIds.has(row.chunkId)) continue;
    const chunk = chunkMap.get(row.chunkId);
    if (!chunk) {
      // orphan embedding — skip
      continue;
    }
    if (!chunk.userId) {
      // legacy chunk without userId — skip
      continue;
    }
    const vector = vectorBufferToArray(row.vector);
    if (vector.length !== 384) {
      console.warn(`[backfill] dim mismatch for ${row.chunkId}: ${vector.length}`);
      failed.push(row.chunkId);
      continue;
    }
    records.push({
      chunkId: row.chunkId,
      userId: chunk.userId,
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      vector,
    });
  }

  // Upsert in batches of 100
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      await store.upsertChunkVectors(batch);
      totalUpserted += batch.length;
      console.log(`[backfill] upserted ${totalUpserted} so far...`);
    } catch (err) {
      console.error(`[backfill] batch failed at offset ${offset}+${i}: ${err.message}`);
      failed.push(...batch.map((r) => r.chunkId));
    }
  }

  offset += PAGE_SIZE;
}

if (failed.length > 0) {
  await writeFile(FAILED_PATH, JSON.stringify(failed));
  console.error(`\n[backfill] ${failed.length} failed. See ${FAILED_PATH}`);
  process.exit(1);
}

// Sanity check: count Turso vs Milvus
const [{ count: tursoCount }] = await db
  .select({ count: db.$count(knowledgeChunkEmbeddings) })
  .from(knowledgeChunkEmbeddings);

const milvusStats = await milvusClient.getCollectionStatistics({
  collection_name: collectionName,
});
const milvusCount = Number(
  milvusStats.stats.find((s) => s.key === "row_count")?.value ?? 0
);

console.log(`\n[backfill] complete:`);
console.log(`  Turso embeddings : ${tursoCount}`);
console.log(`  Milvus row count : ${milvusCount}`);
console.log(`  Diff             : ${milvusCount - Number(tursoCount)}`);

if (Math.abs(milvusCount - Number(tursoCount)) > 5) {
  console.error("Counts diverge by more than 5. Investigate.");
  process.exit(1);
}
```

- [ ] **Step 10.2: Run the backfill against your local Turso**

```pwsh
node --experimental-strip-types --env-file=.env.local scripts/backfill-milvus.mjs
```

Expected: pages through chunks, upserts ~200 records, prints final count diff. If failures appear, investigate the `.backfill-milvus-failed.json` file.

- [ ] **Step 10.3: Commit the backfill script**

```bash
git add scripts/backfill-milvus.mjs
git commit -m "feat(rag): backfill script copying SQLite embeddings into Milvus"
```

---

## Task 11: Switch retrieval to Milvus (Commit 2 — read side)

**Files:**
- Modify: `src/server/ai/agentic-rag.ts`
- Modify: `src/server/ai/indexer.ts` (drop SQLite write)

- [ ] **Step 11.1: Modify `agentic-rag.ts` to use Milvus for ANN**

Replace the `// --- Semantic retrieval ---` block (lines 204-246 in current `agentic-rag.ts`) with a Milvus call:

```ts
// --- Semantic retrieval (Milvus, with BM25-only fallback) ---
let semanticMatches: Array<{
  chunk: typeof knowledgeChunks.$inferSelect;
  score: number;
}> = [];

const embeddedQuery = await embedTexts([query], "query").catch((error) => {
  console.warn(
    `[rag] query embedding failed — ${error instanceof Error ? error.message : String(error)}`
  );
  return null;
});

const vectorStore = getVectorStore();
if (embeddedQuery && vectorStore) {
  const queryVector = embeddedQuery.vectors[0] ?? [];
  if (queryVector.length > 0) {
    try {
      const sourceTypes: ("note" | "bookmark")[] | undefined =
        options.scope === "notes"
          ? ["note"]
          : options.scope === "bookmarks"
            ? ["bookmark"]
            : undefined;

      const milvusHits = await vectorStore.searchSimilar({
        userId: options.userId,
        queryVector,
        topK: SEMANTIC_LIMIT,
        sourceTypes,
      });

      semanticMatches = milvusHits
        .map((hit) => {
          const chunk = chunkMap.get(hit.chunkId);
          if (!chunk) return null; // orphan from partial delete — drop
          return { chunk, score: hit.score };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    } catch (err) {
      console.warn(
        `[rag] Milvus search failed, falling back to BM25-only — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
```

Don't forget to add the import at the top:

```ts
import { getVectorStore } from "./vector-store";
```

And remove the unused imports of `dotProduct`, `vectorBufferToArray`, `knowledgeChunkEmbeddings`, and `inArray` if they're no longer referenced elsewhere in the file. Run `pnpm build` to surface any unused-import errors.

- [ ] **Step 11.2: Drop SQLite embedding writes from `indexer.ts`**

In `syncSourceIndex` (around line 250), remove the `db.insert(knowledgeChunkEmbeddings).values(...)` block. The Milvus upsert added in Task 9 stays. The block becomes:

```ts
const embedded = await embedTexts(nextChunks.map((chunk) => chunk.text));

if (embedded) {
  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.upsertChunkVectors(
      embedded.vectors.map((vector, index) => ({
        chunkId: insertedChunks[index]!.id,
        userId,
        sourceType,
        sourceId,
        vector,
      }))
    );
  }
}
```

Similarly in `fillMissingEmbeddingsForExistingChunks`: drop the `db.insert(knowledgeChunkEmbeddings)`. The check for "missing" must now query Milvus instead. Replace the function:

```ts
async function fillMissingEmbeddingsForExistingChunks(
  existing: ExistingChunkRow[]
) {
  if (existing.length === 0) return;
  const vectorStore = getVectorStore();
  if (!vectorStore) return;

  const existingIds = existing.map((chunk) => chunk.id);
  const presentInMilvus = await vectorStore.existsByChunkIds(existingIds);
  const missing = existing.filter((chunk) => !presentInMilvus.has(chunk.id));
  if (missing.length === 0) return;

  const embedded = await embedTexts(missing.map((chunk) => chunk.text));
  if (!embedded) return;

  await vectorStore.upsertChunkVectors(
    embedded.vectors.map((vector, index) => ({
      chunkId: missing[index]!.id,
      userId: missing[index]!.userId ?? "",
      sourceType: missing[index]!.sourceType,
      sourceId: missing[index]!.sourceId,
      vector,
    }))
  );
}
```

Drop the SQLite delete in `deleteChunkRows`:

```ts
if (chunkIds.length > 0) {
  // SQLite embeddings table no longer used as source of truth — kept only
  // for rollback safety until Task 12. The Milvus delete is the live path.
  await db
    .delete(knowledgeChunkEmbeddings)
    .where(inArray(knowledgeChunkEmbeddings.chunkId, chunkIds));

  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.deleteByChunkIds(chunkIds);
  }
}
```

(Keep the SQLite delete for rollback safety — it's removed in Task 12.)

- [ ] **Step 11.3: Verify build and lint**

```pwsh
pnpm build
pnpm exec eslint src/server/ai/agentic-rag.ts src/server/ai/indexer.ts
```

Expected: clean. Imports of `dotProduct` / `vectorBufferToArray` / `knowledgeChunkEmbeddings` / `inArray` may need pruning in agentic-rag.ts.

- [ ] **Step 11.4: Run the eval — capture post-Milvus numbers**

```pwsh
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --out eval/results/post-milvus.json
```

Expected: recall@10 within ±0.05 of `eval/results/baseline.json`. If recall drops materially, do not commit yet — re-check the COSINE metric, the 384-dim setting, and that `existsByChunkIds` covers all backfilled rows.

- [ ] **Step 11.5: Smoke-test in the dev server**

```pwsh
pnpm dev
```

Open `/ask` in the browser, send "评价一下我", and verify that an answer streams back. Stop the dev server.

- [ ] **Step 11.6: Commit**

```bash
git add src/server/ai/agentic-rag.ts src/server/ai/indexer.ts
git commit -m "feat(rag): switch ANN retrieval to Milvus, drop SQLite embedding writes (commit 2/3)"
```

---

## Task 12: Drop the legacy SQLite embeddings table (Commit 3 — cleanup)

**Files:**
- Modify: `src/server/db/schema/knowledge.ts`
- Modify: `src/server/ai/indexer.ts`
- Generate: `drizzle/<NNNN>_drop_knowledge_chunk_embeddings.sql`

> Wait at least a few days after Task 11 ships before doing this task. The point is to keep the rollback option open while you observe behavior.

- [ ] **Step 12.1: Remove `knowledgeChunkEmbeddings` from the schema**

In `src/server/db/schema/knowledge.ts`, delete the entire `export const knowledgeChunkEmbeddings = sqliteTable(...)` block (lines 37-45 in the current file).

- [ ] **Step 12.2: Remove all imports/references in `indexer.ts`**

In `src/server/ai/indexer.ts`:
- Remove `knowledgeChunkEmbeddings` from the import list (line 7).
- In `deleteChunkRows`, remove the `db.delete(knowledgeChunkEmbeddings)` call. The block becomes:

```ts
if (chunkIds.length > 0) {
  const vectorStore = getVectorStore();
  if (vectorStore) {
    await vectorStore.deleteByChunkIds(chunkIds);
  }
}
```

- Remove `vectorArrayToBuffer` from the embeddings import — it's no longer used.

- [ ] **Step 12.3: Generate the migration**

```pwsh
pnpm db:generate
```

Expected: a new file appears under `drizzle/` named like `NNNN_drop_knowledge_chunk_embeddings.sql`. Open it and verify it contains `DROP TABLE knowledge_chunk_embeddings;` and nothing else surprising.

- [ ] **Step 12.4: Apply the migration to local Turso**

```pwsh
pnpm db:push
```

Expected: drizzle-kit asks for confirmation, applies the drop. Verify with the studio:

```pwsh
pnpm db:studio
```

The `knowledge_chunk_embeddings` table should no longer appear.

- [ ] **Step 12.5: Apply to production Turso**

Per `CLAUDE.md` rule 4, schema changes that affect production must be verified in production. Use the production Turso credentials in `.env.turso-prod.local`:

```pwsh
$env:TURSO_DATABASE_URL = (Get-Content .env.turso-prod.local | Select-String "TURSO_DATABASE_URL").ToString().Split("=")[1]
$env:TURSO_AUTH_TOKEN = (Get-Content .env.turso-prod.local | Select-String "TURSO_AUTH_TOKEN").ToString().Split("=")[1]
pnpm db:push
```

Expected: the same drop is applied to production Turso. Verify by querying:

```pwsh
node --env-file=.env.turso-prod.local -e "
import('@libsql/client').then(async ({ createClient }) => {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_chunk_embeddings'\");
  console.log('Table present:', r.rows.length > 0);
});
"
```

Expected: `Table present: false`.

- [ ] **Step 12.6: Run the eval again to verify the cleanup didn't break anything**

```pwsh
node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs
```

Expected: recall numbers consistent with the post-Milvus run from Task 11.

- [ ] **Step 12.7: Commit the cleanup + add changelog entry**

Create `docs/changelog/2026-04-NN-milvus-vector-store.md`:

```markdown
# Milvus Vector Store Migration

**Date:** 2026-04-NN
**Goal:** Replace SQLite blob + in-process dot product ANN with Zilliz Cloud Serverless Milvus.

## Key Changes
- New `src/server/ai/vector-store.ts` abstraction for Milvus operations.
- `agentic-rag.ts` semantic retrieval now uses Milvus HNSW with `user_id` filter.
- `indexer.ts` writes to Milvus instead of `knowledge_chunk_embeddings`.
- `knowledge_chunk_embeddings` table dropped from schema (production + local).

## Files Touched
- src/server/ai/vector-store.ts (new)
- src/server/ai/vector-store.test.mjs (new)
- src/server/ai/agentic-rag.ts
- src/server/ai/indexer.ts
- src/server/db/schema/knowledge.ts
- src/instrumentation.ts
- scripts/backfill-milvus.mjs (new)
- scripts/eval-rag.mjs (new)
- eval/ground-truth.json (new)
- drizzle/NNNN_drop_knowledge_chunk_embeddings.sql (generated)
- package.json (+@zilliz/milvus2-sdk-node)

## Verification
- pnpm build: ✅
- pnpm lint: ✅
- pnpm test:e2e: ✅
- node:test (vector-store): ✅
- eval recall@10 baseline vs post-Milvus: within ±0.05
- production Turso: knowledge_chunk_embeddings dropped (verified via SELECT FROM sqlite_master)

## Risks / Follow-up
- Zilliz free tier auto-pauses idle collections; first query post-pause adds ~2s latency.
- If embedding model dim ever changes (currently 384 for e5-small), the collection must be dropped and recreated.
- Agentic RAG (LLM-driven retrieval orchestration) is a separate spec, not yet started.
```

```bash
git add src/server/db/schema/knowledge.ts src/server/ai/indexer.ts drizzle/ docs/changelog/2026-04-NN-milvus-vector-store.md
git commit -m "feat(rag): drop knowledge_chunk_embeddings table (commit 3/3)"
```

- [ ] **Step 12.8: Push and verify production deploy**

```bash
git push origin main
```

Watch the GitHub Actions run for `Deploy To Hetzner`. After completion, hit the production app and verify Ask AI works.

```pwsh
gh run list --branch main --limit 1
```

Expected: most recent run shows `success`.

---

## Self-Review Notes

- All tasks reference exact file paths and complete code. No "TBD" or "similar to above".
- Commit cadence: ~1 commit per logical unit (~12 commits total).
- TDD: Tasks 2-6 are test-first.
- Spec coverage check: all 11 numbered sections of the spec map to at least one task. The "Out of Scope" sections (agentic RAG, BM25 storage, partitioning) are correctly absent — they belong to future plans.
- Type consistency: `VectorRecord`, `VectorSearchResult`, `VectorStore` shapes are the same across vector-store.ts, indexer.ts, agentic-rag.ts, backfill-milvus.mjs, and eval-rag.mjs.
