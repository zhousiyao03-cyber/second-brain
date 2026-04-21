import path from "path";
import { createClient } from "@libsql/client";

/**
 * Self-contained sqlite client for E2E billing test helpers.
 *
 * We intentionally do NOT import `@/server/db` here — that module wires up
 * the full runtime (slow-query proxy, metrics, logger) and requires
 * environment setup that would pull in far more than these helpers need.
 * The helpers run inside the Playwright runner process, which shares the
 * same sqlite file with the billing webServer project (see
 * `playwright.config.ts`'s `TURSO_DATABASE_URL` env var for the billing
 * server at port 3101).
 */
const BILLING_DB_PATH = path.join(
  process.cwd(),
  "data",
  "second-brain.billing.e2e.db",
);

const client = createClient({
  url: `file:${BILLING_DB_PATH}`,
});

/**
 * Move the user's `created_at` into the past so we can synthesize trial /
 * grandfather conditions without waiting real wall-clock time.
 */
export async function backdateUserCreation(userId: string, daysAgo: number) {
  const epochSeconds = Math.floor((Date.now() - daysAgo * 86_400_000) / 1000);
  // Drizzle's timestamp mode writes UNIX seconds.
  await client.execute({
    sql: "UPDATE users SET created_at = ? WHERE id = ?",
    args: [epochSeconds, userId],
  });
}

export async function resetUserCreation(userId: string) {
  await client.execute({
    sql: "UPDATE users SET created_at = ? WHERE id = ?",
    args: [Math.floor(Date.now() / 1000), userId],
  });
}

export async function clearSubscription(userId: string) {
  await client.execute({
    sql: "DELETE FROM subscriptions WHERE user_id = ?",
    args: [userId],
  });
}

type SeedStatus =
  | "on_trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "paused";

export async function seedSubscription(
  userId: string,
  status: SeedStatus,
  periodEndDaysFromNow: number,
) {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const periodEnd = Math.floor(
    (Date.now() + periodEndDaysFromNow * 86_400_000) / 1000,
  );
  // Delete-then-insert keeps the helper simple; the unique index on user_id
  // means we can't have two rows regardless.
  await clearSubscription(userId);
  await client.execute({
    sql: `INSERT INTO subscriptions (
      id, user_id, ls_subscription_id, ls_customer_id, ls_variant_id,
      plan, status, current_period_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      `seed-${userId}-${id}`,
      "seed-customer",
      "seed-variant",
      "pro",
      status,
      periodEnd,
      now,
      now,
    ],
  });
}

export async function seedManyNotes(userId: string, count: number) {
  const now = Math.floor(Date.now() / 1000);
  const stmts = Array.from({ length: count }, (_, i) => ({
    sql: `INSERT INTO notes (
      id, user_id, title, content, plain_text, type, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      userId,
      `seed-note-${i}`,
      null,
      "",
      "note",
      0,
      now,
      now,
    ],
  }));
  await client.batch(stmts, "write");
}

export async function clearSeededNotes(userId: string) {
  await client.execute({
    sql: "DELETE FROM notes WHERE user_id = ?",
    args: [userId],
  });
}
