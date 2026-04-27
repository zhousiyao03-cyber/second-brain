import { eq } from "drizzle-orm";
import MiniSearch from "minisearch";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { db } from "../db";
import { knowledgeChunks } from "../db/schema";
import { embedTexts } from "./embeddings";
import { ensureKnowledgeBaseSeeded } from "./indexer";
import { tokenize, tokenizeForIndex } from "./tokenizer";
import { getVectorStore } from "./vector-store";

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

const KEYWORD_LIMIT = 18;
const SEMANTIC_LIMIT = 18;
const SEED_LIMIT = 8;
const FINAL_LIMIT = 16;
const RECENT_QUERY_REGEX = /最近|最新|近期|刚刚|这几天|最近的/;
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

export async function retrieveAgenticContext(
  query: string,
  options: { scope?: AskAiSourceScope; userId?: string | null } = {}
) {
  // Fail-closed: without a userId we cannot scope results safely.
  if (!options.userId) {
    return [] satisfies AgenticRetrievalResult[];
  }

  await ensureKnowledgeBaseSeeded();

  const profile = buildQueryProfile(query);
  const allChunks = await db
    .select()
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.userId, options.userId));
  const scopedChunks = allChunks.filter((chunk) =>
    matchesScope(chunk.sourceType, options.scope)
  );

  if (scopedChunks.length === 0) {
    return [] satisfies AgenticRetrievalResult[];
  }

  // --- BM25 keyword retrieval via MiniSearch ---
  const miniSearch = new MiniSearch<{
    id: string;
    title: string;
    section: string;
    text: string;
  }>({
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

  // --- Semantic retrieval (Milvus ANN，BM25-only fallback) ---
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

  const seedChunks = [...fusedScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, SEED_LIMIT)
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

  if (seedChunks.length === 0) {
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

  return [...expanded.values()]
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
}
