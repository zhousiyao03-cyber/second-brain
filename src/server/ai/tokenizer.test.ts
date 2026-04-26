import { describe, expect, it } from "vitest";
import { tokenize, tokenizeForIndex } from "./tokenizer";

describe("tokenize", () => {
  it("returns Latin tokens lowercased and >=2 chars", () => {
    const tokens = tokenize("RAG and MCP");
    expect(tokens).toContain("rag");
    expect(tokens).toContain("mcp");
  });

  it("does not lose CJK terms outside any predefined dictionary", () => {
    // The old dictionary-based tokenizer dropped these entirely (returned []).
    // The new tokenizer must produce *something* searchable.
    const cases = [
      "向量库选型",
      "婴幼儿培养",
      "推理 训练 范式 演化",
      "Embedding 模型怎么选型",
      "为什么向量检索之后还要加 Reranker",
    ];

    for (const query of cases) {
      const tokens = tokenize(query);
      expect(tokens.length, `query: ${query}`).toBeGreaterThan(0);
    }
  });

  it("emits bigrams as a fallback for CJK runs", () => {
    // "向量库" — even if ICU doesn't recognize the compound,
    // the bigram fallback guarantees at least 向量 + 量库.
    const tokens = tokenize("向量库");
    expect(tokens).toContain("向量");
    expect(tokens).toContain("量库");
  });

  it("handles mixed CJK + Latin queries", () => {
    const tokens = tokenize("Mamba 是什么");
    expect(tokens).toContain("mamba");
  });

  it("dedupes the query token list", () => {
    const tokens = tokenize("RAG RAG RAG");
    expect(tokens.filter((t) => t === "rag")).toHaveLength(1);
  });

  it("strips out punctuation-only segments", () => {
    const tokens = tokenize("???");
    expect(tokens).toEqual([]);
  });
});

describe("tokenizeForIndex", () => {
  it("preserves duplicates so MiniSearch can compute term frequency", () => {
    const tokens = tokenizeForIndex("RAG RAG RAG");
    expect(tokens.filter((t) => t === "rag")).toHaveLength(3);
  });

  it("emits bigrams for indexing too", () => {
    // If we don't index bigrams, query-side bigrams have nothing to match.
    const tokens = tokenizeForIndex("向量库");
    expect(tokens).toContain("量库");
  });
});
