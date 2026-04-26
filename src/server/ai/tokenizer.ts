/**
 * Tokenizer for Chinese + Latin mixed text.
 *
 * CJK: Intl.Segmenter (Node 18+, ICU-backed) for word segmentation,
 * with bigrams emitted alongside as a robustness net for technical
 * jargon the segmenter doesn't know (e.g. "向量库", "选型", "婴幼儿").
 * Bigrams are a well-known fallback for Chinese BM25 — they trade some
 * precision for very high recall, which is the right call for personal
 * notes where we mostly care about "did the query match anything at all".
 *
 * Latin: regex extraction of [a-z0-9._-]+ tokens (length >= 2).
 *
 * Stopwords: via `stopword` package (English + Chinese).
 *
 * Design: NO hardcoded dictionary. The previous dictionary-based
 * forward-max-match was dropping the majority of real-world tokens
 * because it only knew ~150 generic terms. ICU + bigrams handles
 * arbitrary Chinese without manual upkeep.
 */

import { removeStopwords, eng, zho } from "stopword";

const CJK_RANGE_REGEX = /[㐀-鿿豈-﫿]+/g;
const LATIN_TOKEN_REGEX = /[a-z0-9][a-z0-9._-]{1,}/gi;
const MIN_TOKEN_LENGTH = 2;

const cjkSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

/**
 * Segment one CJK run.
 * Emits two parallel signals into the BM25 index:
 *   1. ICU-segmented word tokens (length >= 2)
 *   2. character bigrams over the full run
 * Both go through MiniSearch as separate features. A query like
 * "向量库" → ICU might give ["向量", "库"]; bigrams give ["向量", "量库"].
 * "向量库" appears in a note as bigrams ["向量", "量库"] — they match.
 */
function segmentCjkRun(run: string): string[] {
  const tokens: string[] = [];

  for (const segment of cjkSegmenter.segment(run)) {
    if (!segment.isWordLike) continue;
    const word = segment.segment;
    if (word.length >= MIN_TOKEN_LENGTH) {
      tokens.push(word);
    }
  }

  for (let i = 0; i + 1 < run.length; i += 1) {
    tokens.push(run.slice(i, i + 2));
  }

  return tokens;
}

function extractTokensInOrder(text: string): string[] {
  const lower = text.toLowerCase();

  const tokens: string[] = [];

  for (const match of lower.matchAll(LATIN_TOKEN_REGEX)) {
    const token = match[0];
    if (token.length >= MIN_TOKEN_LENGTH) {
      tokens.push(token);
    }
  }

  for (const match of lower.matchAll(CJK_RANGE_REGEX)) {
    tokens.push(...segmentCjkRun(match[0]));
  }

  return removeStopwords(removeStopwords(tokens, eng), zho);
}

/**
 * Tokenize for QUERY use — dedup so MiniSearch doesn't double-count
 * a term the user typed twice.
 */
export function tokenize(text: string): string[] {
  return [...new Set(extractTokensInOrder(text))];
}

/**
 * Tokenize for INDEX use — keep duplicates for term frequency.
 */
export function tokenizeForIndex(text: string): string[] {
  return extractTokensInOrder(text);
}
