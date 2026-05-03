import { count, eq, max } from "drizzle-orm";
import MiniSearch from "minisearch";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { db } from "../db";
import { knowledgeChunks } from "../db/schema";
import { embedTexts } from "./embeddings";
import { ensureKnowledgeBaseSeeded } from "./indexer";
import { isRerankerEnabled, rerankCandidates } from "./reranker";
import { tokenize, tokenizeForIndex } from "./tokenizer";
import { getVectorStore } from "./vector-store";
import { startAskTimer } from "./ask-timing";

type ChunkRow = typeof knowledgeChunks.$inferSelect;
type SearchDoc = { id: string; title: string; section: string; text: string };

interface CachedIndex {
  fingerprint: string;
  scopedChunks: ChunkRow[];
  miniSearch: MiniSearch<SearchDoc>;
  chunkMap: Map<string, ChunkRow>;
}

// Per-(user,scope) MiniSearch index cache. Rebuilding the index used to
// dominate wall time — a 3.5k-chunk user spent ~7.8s rebuilding it on every
// ask even though the chunk set rarely changes. We keep up to
// MAX_CACHED_INDEXES entries and evict in insertion order (Map preserves it;
// re-inserting on hit makes that effectively LRU).
const MAX_CACHED_INDEXES = 32;
const indexCache = new Map<string, CachedIndex>();

function makeIndexCacheKey(
  userId: string,
  scope: AskAiSourceScope | undefined
) {
  return `${userId}:${scope ?? "all"}`;
}

function touchCache(key: string, entry: CachedIndex) {
  indexCache.delete(key);
  indexCache.set(key, entry);
}

function evictCacheIfNeeded() {
  while (indexCache.size > MAX_CACHED_INDEXES) {
    const oldestKey = indexCache.keys().next().value;
    if (oldestKey === undefined) break;
    indexCache.delete(oldestKey);
  }
}

export interface AgenticRetrievalResult {
  blockType: string | null;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
  sectionPath: string[];
  sourceId: string;
  sourceTitle: string;
  sourceType: "note" | "bookmark";
}

interface QueryProfile {
  normalized: string;
  preferredType: "note" | "bookmark" | null;
  prefersRecent: boolean;
  prefersSummary: boolean;
  tokens: string[];
}

const KEYWORD_LIMIT = 25;
const SEMANTIC_LIMIT = 25;
// Top-N from RRF fusion that we feed to the cross-encoder. Bigger pool
// gives the reranker more headroom to find non-obvious matches; cost grows
// linearly (~50ms total for 30 candidates on q8 ms-marco-MiniLM).
const RERANK_POOL = 30;
const SEED_LIMIT = 8;
const FINAL_LIMIT = 16;
// Recency intent triggers a third RRF signal (chunks ranked by source_updated_at).
// Keep the regex broad — false positives only mildly bias toward newer chunks,
// while false negatives leave the dominant user pain ("我最近干了啥") unfixed.
const RECENT_QUERY_REGEX =
  /最近|最新|近期|刚刚|刚才|这几天|前几天|几天前|过去几天|今天|昨天|当下|现在|recent|latest|newest|today|yesterday/i;
const SUMMARY_QUERY_REGEX = /总结|概括|汇总|回顾|梳理|整理|盘点|归纳/;
const NOTES_QUERY_REGEX = /笔记|note/;
const BOOKMARKS_QUERY_REGEX = /收藏|书签|链接|网址|bookmark/;

function normalizeText(text: string | null | undefined) {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildQueryProfile(query: string): QueryProfile {
  const normalized = normalizeText(query);
  const prefersNotes = NOTES_QUERY_REGEX.test(normalized);
  const prefersBookmarks = BOOKMARKS_QUERY_REGEX.test(normalized);

  return {
    normalized,
    tokens: tokenize(query),
    prefersRecent: RECENT_QUERY_REGEX.test(query),
    prefersSummary: SUMMARY_QUERY_REGEX.test(query),
    preferredType:
      prefersNotes === prefersBookmarks
        ? null
        : prefersNotes
          ? "note"
          : "bookmark",
  };
}

function parseSectionPath(sectionPath: string | null) {
  if (!sectionPath) return [];

  try {
    const parsed = JSON.parse(sectionPath) as string[];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getRecentBoost(updatedAt: Date | null) {
  if (!updatedAt) return 0;

  const ageInDays =
    (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageInDays <= 1) return 6;
  if (ageInDays <= 7) return 4;
  if (ageInDays <= 30) return 2;
  return 0;
}

function matchesScope(
  sourceType: "note" | "bookmark",
  scope: AskAiSourceScope | undefined
) {
  if (!scope || scope === "all") return true;
  if (scope === "notes") return sourceType === "note";
  if (scope === "bookmarks") return sourceType === "bookmark";
  return false;
}

function addRrfScore(
  scoreMap: Map<string, number>,
  ids: string[],
  weight: number
) {
  ids.forEach((id, index) => {
    const previous = scoreMap.get(id) ?? 0;
    scoreMap.set(id, previous + weight / (60 + index + 1));
  });
}

function toResult(
  chunk: typeof knowledgeChunks.$inferSelect,
  score: number
): AgenticRetrievalResult {
  return {
    blockType: chunk.blockType,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    content: chunk.text,
    score,
    sectionPath: parseSectionPath(chunk.sectionPath),
    sourceId: chunk.sourceId,
    sourceTitle: chunk.sourceTitle,
    sourceType: chunk.sourceType,
  };
}

/**
 * Return an up-to-date MiniSearch index + chunk map for the (user, scope),
 * rebuilding only when the underlying chunk set has changed.
 *
 * Cache invalidation is fingerprint-based: `count + max(source_updated_at)`
 * over the user's chunks. Any insert / delete / source-side edit will move at
 * least one of those (delete → count, new source → both, source edit → max),
 * so the fingerprint catches every relevant mutation.
 *
 * Why `source_updated_at`, not `chunks.updated_at`: the indexer can rewrite
 * chunks for an unchanged source (background re-embed retries, dim migration,
 * etc.) which bumps `chunks.updated_at` even though the *content* is
 * identical. Using the source's own timestamp lets that churn pass through
 * without invalidating the cache. We measured this in prod: with chunks own
 * `updated_at`, indexer retry storms shifted the fingerprint every few
 * seconds and dragged the cache hit rate to nearly zero.
 *
 * The fingerprint query is a tiny aggregate against
 * `knowledge_chunks_user_id_idx` — much cheaper than the full SELECT it
 * replaces on cache hits.
 *
 * Returns `cacheHit: true` when we reused an existing index, so callers can
 * surface that to telemetry.
 */
async function getOrBuildIndex(
  userId: string,
  scope: AskAiSourceScope | undefined
): Promise<{ entry: CachedIndex; cacheHit: boolean }> {
  const cacheKey = makeIndexCacheKey(userId, scope);

  const fingerprintRows = await db
    .select({
      total: count(),
      maxSourceUpdated: max(knowledgeChunks.sourceUpdatedAt),
    })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.userId, userId));
  const fpRow = fingerprintRows[0];
  const total = Number(fpRow?.total ?? 0);
  // drizzle returns max() as the column type; for a timestamp-mode integer
  // column that's a Date | null. Coerce defensively because aggregates over
  // empty sets return NULL, and source_updated_at itself is nullable in the
  // schema (legacy rows pre-source-tracking).
  const maxSourceUpdatedAt =
    fpRow?.maxSourceUpdated instanceof Date
      ? fpRow.maxSourceUpdated.getTime()
      : 0;
  const fingerprint = `${total}:${maxSourceUpdatedAt}`;

  const existing = indexCache.get(cacheKey);
  if (existing && existing.fingerprint === fingerprint) {
    touchCache(cacheKey, existing);
    return { entry: existing, cacheHit: true };
  }

  // Cold path: pull all chunks once, filter to scope, build the index.
  const allChunks = await db
    .select()
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.userId, userId));
  const scopedChunks = allChunks.filter((chunk) =>
    matchesScope(chunk.sourceType, scope)
  );

  const miniSearch = new MiniSearch<SearchDoc>({
    fields: ["title", "section", "text"],
    storeFields: [],
    tokenize: tokenizeForIndex,
    searchOptions: {
      tokenize,
      boost: { title: 3, section: 2, text: 1 },
    },
  });
  const chunkMap = new Map(scopedChunks.map((chunk) => [chunk.id, chunk]));
  miniSearch.addAll(
    scopedChunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.sourceTitle,
      section: parseSectionPath(chunk.sectionPath).join(" "),
      text: chunk.text,
    }))
  );

  const entry: CachedIndex = {
    fingerprint,
    scopedChunks,
    miniSearch,
    chunkMap,
  };
  indexCache.set(cacheKey, entry);
  evictCacheIfNeeded();

  return { entry, cacheHit: false };
}

export async function retrieveAgenticContext(
  query: string,
  options: { scope?: AskAiSourceScope; userId?: string | null } = {}
) {
  // Fail-closed: without a userId we cannot scope results safely.
  if (!options.userId) {
    return [] satisfies AgenticRetrievalResult[];
  }

  const timer = startAskTimer("agentic-rag");

  await ensureKnowledgeBaseSeeded();
  timer.mark("ensureSeed");

  const profile = buildQueryProfile(query);

  const { entry, cacheHit } = await getOrBuildIndex(
    options.userId,
    options.scope
  );
  const { scopedChunks, miniSearch, chunkMap } = entry;
  timer.mark("loadIndex");

  if (scopedChunks.length === 0) {
    timer.end({
      chunks: 0,
      scoped: 0,
      cache: cacheHit ? "hit" : "miss",
      scope: options.scope ?? "all",
    });
    return [] satisfies AgenticRetrievalResult[];
  }

  const bm25Results = miniSearch.search(query, {
    tokenize,
    boost: { title: 3, section: 2, text: 1 },
  });

  const keywordMatches = bm25Results
    .slice(0, KEYWORD_LIMIT)
    .map((result) => {
      const chunk = chunkMap.get(String(result.id))!;
      let score = result.score;

      // Source type preference boost
      if (profile.preferredType === chunk.sourceType) {
        score += 1.5;
      }
      // Recency boost
      if (profile.prefersRecent) {
        score += getRecentBoost(chunk.sourceUpdatedAt) * 0.5;
      }
      // Summary preference boost
      if (profile.prefersSummary && chunk.text.length >= 160) {
        score += 1;
      }

      return { chunk, score };
    })
    .filter((result) => result.score > 0);
  timer.mark("bm25");

  // --- Semantic retrieval (Milvus ANN，BM25-only fallback) ---
  let semanticMatches: Array<{
    chunk: typeof knowledgeChunks.$inferSelect;
    score: number;
  }> = [];

  const embeddedQuery = await embedTexts([query], {
    userId: options.userId,
    kind: "query",
  }).catch((error) => {
    console.warn(
      `[rag] query embedding failed — ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  });
  timer.mark("embed");

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

        // 把 Milvus 返回的 chunkId 映射回内存里 scopedChunks 的 chunk 对象。
        // 命中不到的（孤儿向量、partial delete 残留）直接丢弃 —— Turso 是
        // source of truth，没记录的内容不能进结果集。
        semanticMatches = milvusHits
          .map((hit) => {
            const chunk = chunkMap.get(hit.chunkId);
            if (!chunk) return null;
            return { chunk, score: hit.score };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
      } catch (err) {
        console.warn(
          `[rag] Milvus search failed, 退到 BM25-only — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  timer.mark("milvus");

  const fusedScores = new Map<string, number>();
  addRrfScore(
    fusedScores,
    keywordMatches.map((result) => result.chunk.id),
    1
  );
  addRrfScore(
    fusedScores,
    semanticMatches.map((result) => result.chunk.id),
    1.3
  );

  // Recency intent: add chunks ranked by source_updated_at (newest first) as
  // a third RRF signal. Only activates when the query expresses recency
  // intent (RECENT_QUERY_REGEX), so topic-deep queries are unaffected. Limit
  // to the top RECENCY_POOL chunks so the signal is concentrated on actually-
  // recent material; older chunks fall back to BM25/semantic ranking only.
  if (profile.prefersRecent) {
    const RECENCY_POOL = 20;
    const recencyRanked = scopedChunks
      .filter((chunk) => chunk.sourceUpdatedAt)
      .sort(
        (a, b) =>
          (b.sourceUpdatedAt?.getTime() ?? 0) -
          (a.sourceUpdatedAt?.getTime() ?? 0)
      )
      .slice(0, RECENCY_POOL)
      .map((chunk) => chunk.id);
    addRrfScore(fusedScores, recencyRanked, 1.5);
  }

  // Pool of top RRF candidates that we hand to the cross-encoder. We then
  // pick SEED_LIMIT from the rerank-sorted pool (or fall back to RRF order
  // when reranker disabled / errored).
  const rrfRanked = [...fusedScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, RERANK_POOL)
    .map(([id, score]) => ({
      chunk: scopedChunks.find((candidate) => candidate.id === id),
      score,
    }))
    .filter(
      (
        result
      ): result is {
        chunk: typeof knowledgeChunks.$inferSelect;
        score: number;
      } => Boolean(result.chunk)
    );

  let seedChunks = rrfRanked.slice(0, SEED_LIMIT);

  // For recency-intent queries, skip the cross-encoder reranker. The
  // ms-marco reranker scores semantic relevance but knows nothing about
  // time, so it tends to demote actually-recent diary chunks (which are
  // short and topically diverse) below older topical notes that "look more
  // relevant". Trust the RRF ordering when recency is the dominant signal.
  if (isRerankerEnabled() && rrfRanked.length > 0 && !profile.prefersRecent) {
    try {
      const rerankInputs = rrfRanked.map((entry) => ({
        id: entry.chunk.id,
        // Concatenate title + section + body so the cross-encoder sees the
        // same context the user would when judging relevance. ms-marco was
        // trained on passage-level inputs (~200-400 tokens), so cap at
        // 1200 chars to leave room for the query and special tokens.
        text: [
          entry.chunk.sourceTitle,
          parseSectionPath(entry.chunk.sectionPath).join(" / "),
          entry.chunk.text,
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 1200),
      }));

      const rerankScored = await rerankCandidates(query, rerankInputs);
      const scoreById = new Map(rerankScored.map((r) => [r.id, r.score]));

      seedChunks = rrfRanked
        .map((entry) => ({
          chunk: entry.chunk,
          // Score becomes the cross-encoder logit. RRF score is discarded —
          // its only job was to limit the candidate pool to top RERANK_POOL.
          score: scoreById.get(entry.chunk.id) ?? Number.NEGATIVE_INFINITY,
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, SEED_LIMIT);
    } catch (err) {
      // Fall back to RRF order — better to ship a slightly worse ranking
      // than to fail the whole query.
      console.warn(
        `[rag] reranker failed, 退到 RRF-only — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  timer.mark("rerank");

  if (seedChunks.length === 0) {
    timer.end({
      chunks: scopedChunks.length,
      scoped: scopedChunks.length,
      cache: cacheHit ? "hit" : "miss",
      bm25Hits: keywordMatches.length,
      semHits: semanticMatches.length,
      seeds: 0,
      results: 0,
      scope: options.scope ?? "all",
    });
    return [] satisfies AgenticRetrievalResult[];
  }

  const chunkGroups = new Map<string, typeof knowledgeChunks.$inferSelect[]>();
  for (const chunk of scopedChunks) {
    const key = `${chunk.sourceType}:${chunk.sourceId}`;
    const current = chunkGroups.get(key) ?? [];
    current.push(chunk);
    chunkGroups.set(key, current);
  }

  for (const chunks of chunkGroups.values()) {
    chunks.sort((left, right) => left.chunkIndex - right.chunkIndex);
  }

  const expanded = new Map<string, AgenticRetrievalResult>();

  for (const seed of seedChunks) {
    const key = `${seed.chunk.sourceType}:${seed.chunk.sourceId}`;
    const siblings = chunkGroups.get(key) ?? [];

    for (const sibling of siblings) {
      const distance = Math.abs(sibling.chunkIndex - seed.chunk.chunkIndex);
      if (distance > 1) continue;

      const score = Math.max(seed.score - distance * 0.015, 0);
      const previous = expanded.get(sibling.id);
      if (!previous || previous.score < score) {
        expanded.set(sibling.id, toResult(sibling, score));
      }
    }
  }

  const finalResults = [...expanded.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.sourceType === right.sourceType && left.sourceId === right.sourceId) {
        return left.chunkIndex - right.chunkIndex;
      }

      return left.sourceTitle.localeCompare(right.sourceTitle, "zh-CN");
    })
    .slice(0, FINAL_LIMIT);

  timer.mark("fuseExpand");
  timer.end({
    chunks: scopedChunks.length,
    scoped: scopedChunks.length,
    cache: cacheHit ? "hit" : "miss",
    bm25Hits: keywordMatches.length,
    semHits: semanticMatches.length,
    seeds: seedChunks.length,
    results: finalResults.length,
    scope: options.scope ?? "all",
  });

  return finalResults;
}
