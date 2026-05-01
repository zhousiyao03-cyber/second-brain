import { describe, it, expect } from "vitest";
import { applyTagFilter, type PersonaRagHit } from "../persona-rag";

const hits: PersonaRagHit[] = [
  {
    chunkId: "c1",
    chunkIndex: 0,
    content: "RAG content",
    score: 0.9,
    sectionPath: [],
    sourceId: "n1",
    sourceTitle: "RAG note",
    sourceType: "note",
    blockType: null,
    sourceTags: ["ai", "rag"],
  },
  {
    chunkId: "c2",
    chunkIndex: 0,
    content: "Frontend content",
    score: 0.8,
    sectionPath: [],
    sourceId: "n2",
    sourceTitle: "Frontend note",
    sourceType: "note",
    blockType: null,
    sourceTags: ["frontend"],
  },
];

describe("applyTagFilter", () => {
  it("returns all hits when scopeTags is empty", () => {
    expect(applyTagFilter(hits, [])).toHaveLength(2);
  });

  it("filters by Any-of-tags (single tag match)", () => {
    const out = applyTagFilter(hits, ["frontend"]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceTitle).toBe("Frontend note");
  });

  it("filters by Any-of-tags (multiple tags, OR semantics)", () => {
    expect(applyTagFilter(hits, ["frontend", "ai"])).toHaveLength(2);
  });

  it("is case-insensitive on tag matching", () => {
    expect(applyTagFilter(hits, ["FRONTEND"])).toHaveLength(1);
  });

  it("returns empty when no tags match", () => {
    expect(applyTagFilter(hits, ["devops"])).toHaveLength(0);
  });
});
