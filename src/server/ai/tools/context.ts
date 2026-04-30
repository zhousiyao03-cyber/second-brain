/**
 * Shared context that the route handler builds once per request and threads
 * into every tool. Keeps the per-tool factories pure: they take this and
 * return a `tool()` instance, no globals.
 */

import type { UrlBudget } from "./fetch-url-budget";

export type AskAiToolContext = {
  /** authenticated user — enforced in DB-touching tools as a where clause */
  userId: string;
  /** stable id for the current chat (chatInputSchema.id, falls back to a uuid) */
  conversationId: string;
  /** per-conversation fetchUrl budget */
  urlBudget: UrlBudget;
};
