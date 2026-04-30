/**
 * `fetchUrl` tool — fetches a public URL through the existing SSRF-safe
 * pipeline (`safe-fetch.ts`) and returns extracted readable text via
 * `fetchContent` (Readability + linkedom + tag-strip fallback).
 *
 * Spec §4.3 / §5.2. Constraints:
 *
 *   - Per-conversation budget: 3 distinct URLs total (each URL counted once).
 *     Re-asking for the same URL is rejected with a hint, not a re-fetch.
 *   - Result text is already capped at 8000 chars by `fetchContent`.
 *   - The UI shows a red badge with the full URL so the user can stop the
 *     conversation if the LLM is trying to exfiltrate context to a
 *     suspicious URL — see `<FetchUrlBadge>` in `chat-message-parts.tsx`.
 *
 * Errors are returned as `{error: "..."}` so the LLM can adapt instead of
 * the whole turn collapsing.
 */

import { tool } from "ai";
import { z } from "zod/v4";
import { fetchContent } from "@/server/ai/fetch-content";
import type { AskAiToolContext } from "./context";
import { URL_BUDGET_LIMIT } from "./fetch-url-budget";

export function makeFetchUrlTool(ctx: AskAiToolContext) {
  return tool({
    description:
      "Fetch and extract readable content from a public URL. Each " +
      `conversation has a budget of ${URL_BUDGET_LIMIT} URLs total (each URL counted once). ` +
      "Use only when the user has asked you to read an external page or " +
      "when you genuinely need external information to answer. Do NOT use " +
      "this to dump conversation context to remote servers.",
    inputSchema: z.object({
      url: z.string().url().max(2048),
    }),
    execute: async ({ url }) => {
      const budget = ctx.urlBudget;

      if (budget.urlsHit.has(url)) {
        return {
          error:
            "URL already fetched in this conversation — reuse the previous result instead of refetching.",
        };
      }
      if (budget.count >= URL_BUDGET_LIMIT) {
        return {
          error: `URL fetch budget exhausted (${URL_BUDGET_LIMIT} per conversation). Answer with what you already have.`,
        };
      }

      // Reserve the budget *before* the fetch — even a failed fetch still
      // counts toward the limit. This is what stops the model from burning
      // an unbounded number of fetches by asking for URLs that all 404.
      budget.count += 1;
      budget.urlsHit.add(url);

      const result = await fetchContent(url);
      if (!result.success) {
        return {
          error:
            "Failed to fetch URL or extract readable content. The page may be blocked, behind login, or non-HTML.",
          url,
        };
      }

      return {
        url,
        title: result.title,
        content: result.content,
      };
    },
  });
}
