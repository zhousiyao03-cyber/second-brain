import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/ai/provider", () => ({
  generateStructuredData: vi.fn(),
}));

import { generateStructuredData } from "@/server/ai/provider";
import { classifyShouldSpeak, buildClassifierPrompt } from "../classifier";
import type { Persona } from "../types";

const persona: Persona = {
  id: "p1",
  userId: "u1",
  name: "AI 工程师",
  avatarEmoji: "🤖",
  systemPrompt: "你是 AI 工程师",
  styleHint: "技术派",
  scopeKind: "notes",
  scopeRefId: null,
  scopeTags: null,
  isPreset: true,
  createdAt: 0,
  updatedAt: 0,
};

describe("buildClassifierPrompt", () => {
  it("includes persona name + style hint + recent history", () => {
    const prompt = buildClassifierPrompt({
      persona,
      history: [
        { role: "user", content: "RAG reranker?", personaName: null },
        { role: "agent", content: "yes", personaName: "AI 工程师" },
      ],
    });
    expect(prompt).toContain("AI 工程师");
    expect(prompt).toContain("技术派");
    expect(prompt).toContain("RAG reranker?");
  });

  it("biases toward speaking — silence is failure", () => {
    const prompt = buildClassifierPrompt({
      persona,
      history: [{ role: "user", content: "在吗", personaName: null }],
    });
    // Heated-discussion bias: classifier should default to speaking, only
    // staying silent in two narrow cases. Guards against drift back to the
    // old "polite refusal" behavior.
    expect(prompt).toContain("Default: shouldSpeak=true");
    expect(prompt).toContain("silence is failure");
  });
});

describe("classifyShouldSpeak", () => {
  it("returns parsed decision when LLM responds with valid JSON", async () => {
    vi.mocked(generateStructuredData).mockResolvedValueOnce({
      shouldSpeak: true,
      priority: 0.8,
      reason: "I have data",
    } as never);
    const d = await classifyShouldSpeak({
      persona,
      history: [],
      userId: "u1",
    });
    expect(d.shouldSpeak).toBe(true);
    expect(d.priority).toBe(0.8);
  });

  it("falls back to no when LLM throws", async () => {
    vi.mocked(generateStructuredData).mockRejectedValueOnce(new Error("rate limit"));
    const d = await classifyShouldSpeak({
      persona,
      history: [],
      userId: "u1",
    });
    expect(d).toEqual({ shouldSpeak: false, priority: 0, reason: "classifier-error" });
  });

  it("re-throws AbortError instead of swallowing it", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.mocked(generateStructuredData).mockRejectedValueOnce(abortErr);
    await expect(
      classifyShouldSpeak({
        persona,
        history: [],
        userId: "u1",
      })
    ).rejects.toThrow("aborted");
  });
});
