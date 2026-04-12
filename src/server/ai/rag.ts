import { eq } from "drizzle-orm";
import MiniSearch from "minisearch";
import { db } from "../db";
import { bookmarks, notes } from "../db/schema";
import type { AskAiSourceScope } from "@/lib/ask-ai";
import { tokenize, tokenizeForIndex } from "./tokenizer";

export interface RetrievalResult {
  id: string;
  type: "note" | "bookmark";
  title: string;
  content: string;
  matchScore: number;
}

interface QueryProfile {
  normalized: string;
  tokens: string[];
  prefersRecent: boolean;
  prefersSummary: boolean;
  preferredType: "note" | "bookmark" | null;
}

interface SearchRecord {
  id: string;
  type: "note" | "bookmark";
  title: string;
  content: string;
  searchable: string;
  normalizedTitle: string;
  updatedAt: number;
}

interface RetrieveContextOptions {
  scope?: AskAiSourceScope;
  userId?: string | null;
}

const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 2000;

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

function toTimestamp(value: Date | string | number | null | undefined) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getRecentBoost(updatedAt: number) {
  if (!updatedAt) return 0;

  const ageInDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
  if (ageInDays <= 1) return 6;
  if (ageInDays <= 7) return 4;
  if (ageInDays <= 30) return 2;
  return 0;
}

function getContentExcerpt(content: string, tokens: string[]) {
  if (content.length <= MAX_CONTENT_LENGTH) {
    return content;
  }

  const normalizedContent = content.toLowerCase();
  const firstMatch = tokens
    .map((token) => normalizedContent.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstMatch == null) {
    return content.slice(0, MAX_CONTENT_LENGTH);
  }

  const start = Math.max(0, firstMatch - 240);
  const end = Math.min(content.length, start + MAX_CONTENT_LENGTH);

  return `${start > 0 ? "..." : ""}${content.slice(start, end).trim()}${
    end < content.length ? "..." : ""
  }`;
}

function matchesScope(
  record: SearchRecord,
  scope: AskAiSourceScope | undefined
) {
  if (!scope || scope === "all") return true;
  if (scope === "notes") return record.type === "note";
  if (scope === "bookmarks") return record.type === "bookmark";
  return false;
}

function shouldUseRecentFallback(profile: QueryProfile) {
  if (!profile.prefersRecent) {
    return false;
  }

  return profile.prefersSummary || profile.preferredType !== null;
}

function resolvePreferredType(
  profile: QueryProfile,
  scope: AskAiSourceScope | undefined
) {
  if (scope === "notes") return "note";
  if (scope === "bookmarks") return "bookmark";
  return profile.preferredType;
}

export async function retrieveContext(
  query: string,
  options: RetrieveContextOptions = {}
): Promise<RetrievalResult[]> {
  // Fail-closed: without a userId we cannot scope results safely.
  if (!options.userId) {
    return [];
  }

  const profile = buildQueryProfile(query);
  const preferredType = resolvePreferredType(profile, options.scope);

  const allNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, options.userId));
  const allBookmarks = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, options.userId));

  const records: SearchRecord[] = [
    ...allNotes.map((note) => {
      const content = (note.plainText ?? "").trim();

      return {
        id: note.id,
        type: "note" as const,
        title: note.title,
        content,
        searchable: [note.title, note.plainText].join(" "),
        normalizedTitle: normalizeText(note.title),
        updatedAt: toTimestamp(note.updatedAt),
      };
    }),
    ...allBookmarks.map((bookmark) => {
      const title = bookmark.title ?? bookmark.url ?? "无标题";
      const content = (bookmark.content ?? bookmark.summary ?? "").trim();

      return {
        id: bookmark.id,
        type: "bookmark" as const,
        title,
        content,
        searchable: [bookmark.title, bookmark.url, bookmark.content, bookmark.summary].join(" "),
        normalizedTitle: normalizeText(title),
        updatedAt: toTimestamp(bookmark.updatedAt),
      };
    }),
  ];

  const scopedRecords = records.filter((record) =>
    matchesScope(record, options.scope)
  );

  if (profile.tokens.length > 0) {
    // Build MiniSearch index for BM25 scoring
    const miniSearch = new MiniSearch<{
      id: string;
      title: string;
      content: string;
    }>({
      fields: ["title", "content"],
      storeFields: [],
      tokenize: tokenizeForIndex,
      searchOptions: {
        tokenize,
        boost: { title: 3, content: 1 },
      },
    });

    miniSearch.addAll(
      scopedRecords.map((record) => ({
        id: record.id,
        title: record.title,
        content: record.searchable,
      }))
    );

    const bm25Results = miniSearch.search(query, {
      tokenize,
      boost: { title: 3, content: 1 },
    });

    const recordMap = new Map(scopedRecords.map((r) => [r.id, r]));

    const scoredResults = bm25Results
      .map((result) => {
        const record = recordMap.get(String(result.id));
        if (!record) return null;

        let score = result.score;

        if (preferredType === record.type) {
          score += 1.5;
        }
        if (profile.prefersRecent) {
          score += getRecentBoost(record.updatedAt) * 0.5;
        }
        if (profile.prefersSummary && record.content.length >= 160) {
          score += 1;
        }

        return { record, matchScore: score };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.matchScore > 0)
      .slice(0, MAX_RESULTS)
      .map(({ record, matchScore }) => ({
        id: record.id,
        type: record.type,
        title: record.title,
        content: getContentExcerpt(record.content, profile.tokens),
        matchScore,
      }));

    if (scoredResults.length > 0) {
      return scoredResults;
    }
  }

  if (
    !shouldUseRecentFallback({
      ...profile,
      preferredType,
    })
  ) {
    return [];
  }

  return scopedRecords
    .filter((record) => (preferredType ? record.type === preferredType : true))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RESULTS)
    .map((record, index) => ({
      id: record.id,
      type: record.type,
      title: record.title,
      content: getContentExcerpt(record.content, profile.tokens),
      matchScore: MAX_RESULTS - index,
    }));
}
