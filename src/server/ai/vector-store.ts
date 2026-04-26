// Milvus SDK 只在运行时通过动态 import 加载。原因：@zilliz/milvus2-sdk-node
// 的 transitive deps（@dsnp/parquetjs → thrift）是 native/optional 模块，
// Turbopack build 阶段会尝试 resolve 失败。动态 import 让 bundler 跳过整
// 条链，运行时由 Node 的 require 直接加载（这条路径 Node 能正确处理 native
// optional dep）。

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

const VECTOR_DIM = 384;

function getCollectionName(): string {
  return process.env.MILVUS_COLLECTION?.trim() || "knosi_knowledge_chunks";
}

interface MilvusClientLike {
  hasCollection: (args: { collection_name: string }) => Promise<{
    value: boolean;
  }>;
  createCollection: (args: unknown) => Promise<{ error_code?: string }>;
  createIndex: (args: unknown) => Promise<{ error_code?: string }>;
  loadCollection: (args: { collection_name: string }) => Promise<{
    error_code?: string;
  }>;
  upsert: (args: { collection_name: string; data: unknown[] }) => Promise<{
    status?: { error_code?: string; reason?: string };
  }>;
  query: (args: {
    collection_name: string;
    filter: string;
    output_fields: string[];
    limit?: number;
  }) => Promise<{ data?: Array<Record<string, unknown>> }>;
  search: (args: {
    collection_name: string;
    data: number[][];
    limit: number;
    filter: string;
    output_fields?: string[];
    params?: Record<string, unknown>;
  }) => Promise<{
    results?: Array<{ chunk_id?: string; id?: string; score?: number }>;
  }>;
  deleteEntities: (args: { collection_name: string; filter: string }) => Promise<{
    status?: { error_code?: string; reason?: string };
  }>;
}

let cachedStore: VectorStore | null | undefined;
let testClient: MilvusClientLike | null = null;

export function getVectorStore(): VectorStore | null {
  if (cachedStore !== undefined) return cachedStore;

  const uri = process.env.MILVUS_URI?.trim();
  const token = process.env.MILVUS_TOKEN?.trim();

  if (!uri || !token) {
    cachedStore = null;
    return null;
  }

  cachedStore = createMilvusVectorStore({ uri, token });
  return cachedStore;
}

function escapeMilvusString(value: string): string {
  if (/[\n\r\0]/.test(value)) {
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

interface MilvusModule {
  MilvusClient: new (args: { address: string; token: string }) => MilvusClientLike;
  DataType: { VarChar: number; FloatVector: number };
}

let milvusModulePromise: Promise<MilvusModule> | null = null;

async function loadMilvusModule(): Promise<MilvusModule> {
  if (!milvusModulePromise) {
    milvusModulePromise = import("@zilliz/milvus2-sdk-node") as unknown as Promise<MilvusModule>;
  }
  return milvusModulePromise;
}

function createMilvusVectorStore(opts: { uri: string; token: string }): VectorStore {
  let clientPromise: Promise<MilvusClientLike> | null = null;
  let ensured = false;

  async function getClient(): Promise<MilvusClientLike> {
    if (testClient) return testClient;
    if (!clientPromise) {
      clientPromise = (async () => {
        const mod = await loadMilvusModule();
        return new mod.MilvusClient({
          address: opts.uri,
          token: opts.token,
        });
      })();
    }
    return clientPromise;
  }

  async function ensureCollection() {
    if (ensured) return;
    const client = await getClient();
    const collectionName = getCollectionName();

    const exists = await client.hasCollection({
      collection_name: collectionName,
    });

    if (!exists.value) {
      const { DataType } = await loadMilvusModule();
      await client.createCollection({
        collection_name: collectionName,
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
        collection_name: collectionName,
        field_name: "vector",
        index_type: "HNSW",
        metric_type: "COSINE",
        params: { M: 16, efConstruction: 200 },
      });
    }

    await client.loadCollection({ collection_name: collectionName });
    ensured = true;
  }

  async function upsertChunkVectors(records: VectorRecord[]) {
    if (records.length === 0) return;
    await ensureCollection();
    const client = await getClient();
    const collectionName = getCollectionName();

    const BATCH_SIZE = 100;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const result = await client.upsert({
        collection_name: collectionName,
        data: batch.map((r) => ({
          chunk_id: r.chunkId,
          vector: r.vector,
          user_id: r.userId,
          source_type: r.sourceType,
          source_id: r.sourceId,
        })),
      });
      if (
        result.status?.error_code &&
        result.status.error_code !== "Success"
      ) {
        throw new Error(
          `Milvus upsert failed: ${result.status.error_code} ${
            result.status.reason ?? ""
          }`.trim()
        );
      }
    }
  }

  async function existsByChunkIds(chunkIds: string[]): Promise<Set<string>> {
    if (chunkIds.length === 0) return new Set();
    await ensureCollection();
    const client = await getClient();
    const collectionName = getCollectionName();

    const list = chunkIds.map((id) => `"${escapeMilvusString(id)}"`).join(", ");
    const result = await client.query({
      collection_name: collectionName,
      filter: `chunk_id in [${list}]`,
      output_fields: ["chunk_id"],
      limit: chunkIds.length,
    });
    return new Set((result.data ?? []).map((row) => String(row.chunk_id)));
  }

  async function searchSimilar(opts: {
    userId: string;
    queryVector: number[];
    topK: number;
    sourceTypes?: ("note" | "bookmark")[];
  }): Promise<VectorSearchResult[]> {
    await ensureCollection();
    const client = await getClient();
    const collectionName = getCollectionName();

    const filter = buildSearchFilter({
      userId: opts.userId,
      sourceTypes: opts.sourceTypes,
    });
    const ef = Number(process.env.MILVUS_SEARCH_EF) || 64;
    const result = await client.search({
      collection_name: collectionName,
      data: [opts.queryVector],
      limit: opts.topK,
      filter,
      output_fields: ["chunk_id"],
      params: { ef },
    });
    return (result.results ?? []).map((row) => ({
      chunkId: String(row.chunk_id ?? row.id ?? ""),
      score: Number(row.score ?? 0),
    }));
  }

  async function deleteByChunkIds(chunkIds: string[]) {
    if (chunkIds.length === 0) return;
    await ensureCollection();
    const client = await getClient();
    const collectionName = getCollectionName();

    const list = chunkIds.map((id) => `"${escapeMilvusString(id)}"`).join(", ");
    const result = await client.deleteEntities({
      collection_name: collectionName,
      filter: `chunk_id in [${list}]`,
    });
    if (result.status?.error_code && result.status.error_code !== "Success") {
      throw new Error(
        `Milvus delete failed: ${result.status.error_code} ${
          result.status.reason ?? ""
        }`.trim()
      );
    }
  }

  async function deleteBySource(sourceId: string) {
    await ensureCollection();
    const client = await getClient();
    const collectionName = getCollectionName();

    const result = await client.deleteEntities({
      collection_name: collectionName,
      filter: `source_id == "${escapeMilvusString(sourceId)}"`,
    });
    if (result.status?.error_code && result.status.error_code !== "Success") {
      throw new Error(
        `Milvus delete failed: ${result.status.error_code} ${
          result.status.reason ?? ""
        }`.trim()
      );
    }
  }

  return {
    ensureCollection,
    upsertChunkVectors,
    existsByChunkIds,
    searchSimilar,
    deleteByChunkIds,
    deleteBySource,
  };
}

// ─── Test seams ──────────────────────────────────────────────────────

export function __resetVectorStoreForTest() {
  cachedStore = undefined;
}

export function __setMilvusClientForTest(client: MilvusClientLike | null) {
  testClient = client;
  cachedStore = undefined;
}
