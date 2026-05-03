import { retrieveWithFallback } from "@/server/ai/retriever";
import type { RetrievedKnowledgeItem } from "@/server/ai/chat-system-prompt";
import type { Persona } from "./types";
import { db } from "@/server/db";
import { notes, bookmarks } from "@/server/db/schema/notes";
import { inArray } from "drizzle-orm";
import type { AskAiSourceScope } from "@/lib/ask-ai";

/**
 * Augmented hit with source-level tags attached, for in-memory tag filtering.
 * Tag-on-chunks would be a Phase 2/3 optimization (spec §13).
 *
 * Note: this used to wrap AgenticRetrievalResult directly. After unifying
 * council with the Ask AI retrieval pipeline (`retrieveWithFallback`), hits
 * carry the same shape Ask AI consumes — chunkId / chunkIndex /
 * sectionPath are present for agentic results, absent for keyword-fallback.
 */
export type PersonaRagHit = RetrievedKnowledgeItem & {
  sourceType: "note" | "bookmark";
  sourceTitle: string;
  sourceId: string;
  sourceTags: string[];
};

/**
 * Pure: filter enriched hits by Any-of-tags. Empty scopeTags = no filter.
 * Case-insensitive comparison.
 */
export function applyTagFilter(
  hits: PersonaRagHit[],
  scopeTags: string[]
): PersonaRagHit[] {
  if (scopeTags.length === 0) return hits;
  const wanted = new Set(scopeTags.map((t) => t.toLowerCase()));
  return hits.filter((hit) =>
    hit.sourceTags.some((tag) => wanted.has(tag.toLowerCase()))
  );
}

/**
 * Reads notes.tags / bookmarks.tags for the source ids referenced by hits
 * and attaches them as `sourceTags`. Also lifts source-level identifiers
 * (sourceType / sourceTitle / sourceId) onto the hit so downstream code
 * has a single shape to render regardless of which retriever produced it.
 */
export async function enrichWithTags(
  hits: RetrievedKnowledgeItem[]
): Promise<PersonaRagHit[]> {
  if (hits.length === 0) return [];

  const noteIds = hits.filter((h) => h.type === "note").map((h) => h.id);
  const bookmarkIds = hits
    .filter((h) => h.type === "bookmark")
    .map((h) => h.id);

  const tagsByNoteId = new Map<string, string[]>();
  if (noteIds.length > 0) {
    const rows = await db
      .select({ id: notes.id, tags: notes.tags })
      .from(notes)
      .where(inArray(notes.id, noteIds));
    for (const r of rows) tagsByNoteId.set(r.id, parseTagsJson(r.tags));
  }

  const tagsByBookmarkId = new Map<string, string[]>();
  if (bookmarkIds.length > 0) {
    const rows = await db
      .select({ id: bookmarks.id, tags: bookmarks.tags })
      .from(bookmarks)
      .where(inArray(bookmarks.id, bookmarkIds));
    for (const r of rows) tagsByBookmarkId.set(r.id, parseTagsJson(r.tags));
  }

  return hits.map((hit) => ({
    ...hit,
    sourceType: hit.type,
    sourceTitle: hit.title,
    sourceId: hit.id,
    sourceTags:
      hit.type === "note"
        ? tagsByNoteId.get(hit.id) ?? []
        : tagsByBookmarkId.get(hit.id) ?? [],
  }));
}

/**
 * Returns RAG hits for a persona, filtered by scopeKind + scopeTags.
 * Fail-soft: if retrieval throws, returns []. Persona will speak without
 * grounding, which is acceptable for Phase 1.
 */
export async function searchKnowledgeForPersona({
  persona,
  query,
  userId,
}: {
  persona: Persona;
  query: string;
  userId: string;
}): Promise<PersonaRagHit[]> {
  let raw: RetrievedKnowledgeItem[];
  try {
    raw = await retrieveWithFallback(query, {
      scope: persona.scopeKind as AskAiSourceScope, // 'all' | 'notes' | 'bookmarks'
      userId,
    });
  } catch (err) {
    console.warn("[council] retrieveWithFallback failed", err);
    return [];
  }

  const enriched = await enrichWithTags(raw);
  return applyTagFilter(enriched, parseTagsJson(persona.scopeTags));
}

export function parseTagsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
