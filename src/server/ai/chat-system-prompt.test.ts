import { describe, expect, it } from "vitest";
import {
  buildSystemPromptStable,
  buildUserPreamble,
} from "./chat-system-prompt";

describe("buildSystemPromptStable", () => {
  it("does not contain RAG / current_note / pinned_sources blocks", async () => {
    const out = await buildSystemPromptStable("all", null, {
      preferStructuredBlocks: false,
    });
    expect(out).not.toMatch(/<knowledge_base>/);
    expect(out).not.toMatch(/<current_note>/);
    expect(out).not.toMatch(/<pinned_sources>/);
  });

  it("varies output by sourceScope", async () => {
    const all = await buildSystemPromptStable("all", null, {});
    const direct = await buildSystemPromptStable("direct", null, {});
    expect(all).not.toBe(direct);
  });

  it("includes structured-blocks instructions when preferStructuredBlocks is true", async () => {
    const on = await buildSystemPromptStable("all", null, {
      preferStructuredBlocks: true,
    });
    const off = await buildSystemPromptStable("all", null, {
      preferStructuredBlocks: false,
    });
    expect(on).toContain("<ai_blocks>");
    expect(off).not.toContain("<ai_blocks>");
  });

  it("returns the same output for the same inputs (stable contract)", async () => {
    const a = await buildSystemPromptStable("notes", null, {
      preferStructuredBlocks: true,
    });
    const b = await buildSystemPromptStable("notes", null, {
      preferStructuredBlocks: true,
    });
    expect(a).toBe(b);
  });
});

describe("buildUserPreamble", () => {
  it("returns empty string when no context, no pinned, no note", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "all",
      pinnedSources: [],
    });
    expect(out).toBe("");
  });

  it("emits <knowledge_base> when retrieved context is non-empty", () => {
    const out = buildUserPreamble({
      retrieved: [
        { id: "n1", title: "Note A", type: "note", content: "alpha" },
      ],
      sourceScope: "all",
      pinnedSources: [],
    });
    expect(out).toContain("<knowledge_base>");
    expect(out).toContain('<source id="n1"');
    expect(out).toContain("alpha");
  });

  it("emits <current_note> when contextNoteText is set", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "notes",
      pinnedSources: [],
      contextNoteText: "this is the note body",
    });
    expect(out).toContain("<current_note>");
    expect(out).toContain("this is the note body");
  });

  it("emits <pinned_sources> when pinnedSources is non-empty", () => {
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "all",
      pinnedSources: [
        {
          id: "b1",
          title: "Bookmark",
          type: "bookmark",
          content: "pinned content",
        },
      ],
    });
    expect(out).toContain("<pinned_sources>");
    expect(out).toContain('<pinned_source id="b1"');
  });

  it("truncates contextNoteText to ≤ 8000 chars inside the block", () => {
    const long = "x".repeat(12000);
    const out = buildUserPreamble({
      retrieved: [],
      sourceScope: "notes",
      pinnedSources: [],
      contextNoteText: long,
    });
    const noteBlock =
      out.match(/<current_note>\n([\s\S]*?)\n<\/current_note>/)?.[1] ?? "";
    expect(noteBlock.length).toBeLessThanOrEqual(8000);
    expect(noteBlock.length).toBeGreaterThanOrEqual(7900);
  });
});
