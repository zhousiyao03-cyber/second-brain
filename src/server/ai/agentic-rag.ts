import { eq, inArray } from "drizzle-orm";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { db } from "../db";
import {
  knowledgeChunkEmbeddings,
  knowledgeChunks,
} from "../db/schema";
import { dotProduct, embedTexts, vectorBufferToArray } from "./embeddings";
import { ensureKnowledgeBaseSeeded } from "./indexer";

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
  terms: string[];
}

const KEYWORD_LIMIT = 18;
const SEMANTIC_LIMIT = 18;
const SEED_LIMIT = 8;
const FINAL_LIMIT = 16;
const MIN_TERM_LENGTH = 2;
const MAX_CJK_TERM_LENGTH = 4;
const RECENT_QUERY_REGEX = /最近|最新|近期|刚刚|这几天|最近的/;
const SUMMARY_QUERY_REGEX = /总结|概括|汇总|回顾|梳理|整理|盘点|归纳/;
const NOTES_QUERY_REGEX = /笔记|note/;
const BOOKMARKS_QUERY_REGEX = /收藏|书签|链接|网址|bookmark/;
const LATIN_TERM_REGEX = /[a-z0-9][a-z0-9-]{1,}/gi;
const CJK_SEGMENT_REGEX = /[\u3400-\u9fff]+/g;

const QUERY_NOISE_PATTERNS = [
  /帮我/g,
  /一下/g,
  /请问/g,
  /麻烦/g,
  /可以/g,
  /能够/g,
  /能不能/g,
  /一下子/g,
  /我的/g,
  /这个/g,
  /那个/g,
  /请/g,
];

const GENERIC_CJK_TERMS = new Set([
  "一下",
  "帮我",
  "请问",
  "麻烦",
  "可以",
  "能够",
  "最近",
  "这个",
  "那个",
  "我的",
  "一下子",
]);

function normalizeText(text: string | null | undefined) {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueTerms(terms: string[]) {
  return [...new Set(terms.filter((term) => term.length >= MIN_TERM_LENGTH))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 18);
}

function extractAsciiTerms(query: string) {
  return uniqueTerms(query.match(LATIN_TERM_REGEX) ?? []);
}

function cleanCjkSegment(segment: string) {
  let cleaned = segment;

  for (const pattern of QUERY_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned.trim();
}

function extractCjkTerms(query: string) {
  const segments = query.match(CJK_SEGMENT_REGEX) ?? [];
  const terms: string[] = [];

  for (const rawSegment of segments) {
    const segment = cleanCjkSegment(rawSegment);
    if (segment.length < MIN_TERM_LENGTH) continue;

    if (!GENERIC_CJK_TERMS.has(segment)) {
      terms.push(segment);
    }

    const maxLength = Math.min(MAX_CJK_TERM_LENGTH, segment.length);
    for (let size = maxLength; size >= MIN_TERM_LENGTH; size -= 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        const term = segment.slice(index, index + size);
        if (!GENERIC_CJK_TERMS.has(term)) {
          terms.push(term);
        }
      }
    }
  }

  return uniqueTerms(terms);
}

function buildQueryProfile(query: string): QueryProfile {
  const normalized = normalizeText(query);
  const prefersNotes = NOTES_QUERY_REGEX.test(normalized);
  const prefersBookmarks = BOOKMARKS_QUERY_REGEX.test(normalized);

  return {
    normalized,
    terms: uniqueTerms([
      ...extractAsciiTerms(normalized),
      ...extractCjkTerms(query),
    ]),
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

function scoreKeywordMatch(
  chunk: typeof knowledgeChunks.$inferSelect,
  profile: QueryProfile
) {
  const normalizedTitle = normalizeText(chunk.sourceTitle);
  const normalizedText = normalizeText(chunk.text);
  const sectionPathText = normalizeText(parseSectionPath(chunk.sectionPath).join(" "));
  let score = 0;
  let matchedTerms = 0;

  if (
    profile.normalized &&
    (normalizedTitle.includes(profile.normalized) ||
      sectionPathText.includes(profile.normalized))
  ) {
    score += 18;
  }

  for (const term of profile.terms) {
    const inTitle = normalizedTitle.includes(term);
    const inSection = sectionPathText.includes(term);
    const inText = normalizedText.includes(term);

    if (!inTitle && !inSection && !inText) continue;

    matchedTerms += 1;
    const lengthBoost = Math.min(term.length, 6);
    score += inTitle || inSection ? 8 + lengthBoost : 3 + lengthBoost / 2;
  }

  if (matchedTerms === 0) {
    return 0;
  }

  score += matchedTerms * 2;

  if (profile.preferredType === chunk.sourceType) {
    score += 3;
  }

  if (profile.prefersRecent) {
    score += getRecentBoost(chunk.sourceUpdatedAt);
  }

  if (profile.prefersSummary && chunk.text.length >= 160) {
    score += 2;
  }

  return score;
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
  // Scope at the SQL layer using the indexed user_id column. Rows written
  // before the rollout have user_id backfilled by the rollout script and
  // indexer.ts now always sets it on insert.
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

  const keywordMatches = scopedChunks
    .map((chunk) => ({
      chunk,
      score: scoreKeywordMatch(chunk, profile),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, KEYWORD_LIMIT);

  let semanticMatches: Array<{
    chunk: typeof knowledgeChunks.$inferSelect;
    score: number;
  }> = [];

  const embeddedQuery = await embedTexts([query]).catch(() => null);
  if (embeddedQuery) {
    const chunkIds = scopedChunks.map((chunk) => chunk.id);
    const embeddingRows =
      chunkIds.length > 0
        ? await db
            .select()
            .from(knowledgeChunkEmbeddings)
            .where(inArray(knowledgeChunkEmbeddings.chunkId, chunkIds))
        : [];

    const chunkMap = new Map(scopedChunks.map((chunk) => [chunk.id, chunk]));
    const queryVector = embeddedQuery.vectors[0] ?? [];

    semanticMatches = embeddingRows
      .map((embeddingRow) => {
        const chunk = chunkMap.get(embeddingRow.chunkId);
        if (!chunk) return null;

        const vector = vectorBufferToArray(embeddingRow.vector);
        if (vector.length === 0 || vector.length !== queryVector.length) {
          return null;
        }

        return {
          chunk,
          score: dotProduct(queryVector, vector),
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, SEMANTIC_LIMIT);
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
