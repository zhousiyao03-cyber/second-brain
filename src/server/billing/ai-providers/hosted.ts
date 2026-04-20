import { parsePool, pickAccountForUser } from "./account-pool";
import { logger } from "@/server/logger";

export type HostedAiResult<T> =
  | { ok: true; value: T; account: string }
  | { ok: false; error: "NO_POOL" | "ALL_ACCOUNTS_FAILED" };

/**
 * Runs `fn` against a pool account chosen deterministically for `userId`. On
 * 429 / 403 (rate-limited or blocked) the wrapper rotates through the
 * remaining pool accounts in their declared order. Any other error (500,
 * network, etc.) propagates immediately — those indicate a real failure
 * that rotation cannot paper over.
 *
 * Emits structured logs per attempt. Task 34 will add metric counters
 * (`billing.ai.upstream_success` / `billing.ai.upstream_error`); for now
 * `logger.warn` is the only observability surface.
 */
export async function runWithHostedAi<T>(
  userId: string,
  fn: (accountAuthPath: string) => Promise<T>,
): Promise<HostedAiResult<T>> {
  const pool = parsePool(process.env.KNOSI_CODEX_ACCOUNT_POOL);
  if (pool.length === 0) return { ok: false, error: "NO_POOL" };

  const primary = pickAccountForUser(pool, userId)!;
  const ordered = [primary, ...pool.filter((a) => a.name !== primary.name)];

  for (const account of ordered) {
    try {
      const value = await fn(account.authPath);
      logger.debug(
        { account: account.name, event: "billing.ai.hosted.success" },
        "hosted AI call succeeded",
      );
      return { ok: true, value, account: account.name };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      logger.warn(
        { account: account.name, status, err, event: "billing.ai.hosted.error" },
        "hosted AI pool account failed",
      );
      if (status !== 429 && status !== 403) throw err;
      // fall through to next account
    }
  }

  return { ok: false, error: "ALL_ACCOUNTS_FAILED" };
}
