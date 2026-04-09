import type { JSONContent } from "@tiptap/react";

const AI_BLOCKS_REGEX = /<ai_blocks>\s*([\s\S]*?)\s*<\/ai_blocks>/;

/**
 * Extract a structured Tiptap `JSONContent[]` payload from AI output.
 *
 * If the assistant wraps its answer in `<ai_blocks>...</ai_blocks>` XML, we
 * parse the JSON array inside as Tiptap nodes ready for `insertContentAt`.
 * The rest of the text (outside the tags) is returned as `cleanText` so
 * callers can either keep it as a preamble or discard it.
 *
 * On any failure (no tag, malformed JSON, not an array) we return
 * `{ blocks: null, cleanText: originalText }` — callers should then fall
 * back to the existing `aiTextToTiptapJson` path.
 */
export function parseAiBlocks(text: string): {
  blocks: JSONContent[] | null;
  cleanText: string;
} {
  const match = text.match(AI_BLOCKS_REGEX);
  if (!match) return { blocks: null, cleanText: text };

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { blocks: null, cleanText: text };
    }
    const cleanText = text.replace(AI_BLOCKS_REGEX, "").trim();
    return { blocks: parsed as JSONContent[], cleanText };
  } catch {
    return { blocks: null, cleanText: text };
  }
}
