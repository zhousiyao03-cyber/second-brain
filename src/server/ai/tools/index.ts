/**
 * Public entry for the Ask AI tool set. The chat route calls
 * `buildAskAiTools(ctx)` once per request and passes the resulting
 * `ToolSet` into `streamChatResponse`. The tools loop until the model
 * stops emitting tool calls or `stopWhen: stepCountIs(N)` fires.
 *
 * Spec §4.4.
 */

import type { ToolSet } from "ai";
import type { AskAiToolContext } from "./context";
import { makeFetchUrlTool } from "./fetch-url";
import { makeReadNoteTool } from "./read-note";
import { makeSearchKnowledgeTool } from "./search-knowledge";

export type { AskAiToolContext } from "./context";
export {
  getOrCreateUrlBudget,
  URL_BUDGET_LIMIT,
  type UrlBudget,
} from "./fetch-url-budget";

export function buildAskAiTools(ctx: AskAiToolContext): ToolSet {
  return {
    searchKnowledge: makeSearchKnowledgeTool(ctx),
    readNote: makeReadNoteTool(ctx),
    fetchUrl: makeFetchUrlTool(ctx),
  };
}
