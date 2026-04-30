/**
 * Per-conversation URL fetch budget for the `fetchUrl` tool.
 *
 * Spec §5.2 / §4.3: each conversation gets a budget of 3 distinct URLs total
 * (each URL counted once). State lives in a process-local Map — no DB
 * persistence — so a server restart resets all budgets. Acceptable for a
 * single-instance Next.js deployment; revisit if we ever multi-process.
 *
 * The map is bounded at MAX_BUDGETS to prevent slow leaks across long server
 * uptime: when full, we evict the oldest entry (Map preserves insertion
 * order, so this is FIFO-style LRU when callers always call
 * `getOrCreateUrlBudget` rather than touching the map directly).
 */

export const URL_BUDGET_LIMIT = 3;
export const MAX_BUDGETS = 500;

export type UrlBudget = { count: number; urlsHit: Set<string> };

const budgets = new Map<string, UrlBudget>();

export function getOrCreateUrlBudget(conversationId: string): UrlBudget {
  let budget = budgets.get(conversationId);
  if (!budget) {
    if (budgets.size >= MAX_BUDGETS) {
      const oldest = budgets.keys().next().value;
      if (oldest !== undefined) budgets.delete(oldest);
    }
    budget = { count: 0, urlsHit: new Set<string>() };
    budgets.set(conversationId, budget);
  } else {
    // Refresh insertion order so a recently-used budget is "youngest" — keeps
    // the active conversation's budget from getting evicted when the cache
    // fills up.
    budgets.delete(conversationId);
    budgets.set(conversationId, budget);
  }
  return budget;
}

/** Test-only — wipes all budgets so tests can run from a clean slate. */
export function __resetUrlBudgetsForTest(): void {
  budgets.clear();
}

/** Test-only — returns the current size of the budget map. */
export function __getBudgetCountForTest(): number {
  return budgets.size;
}
