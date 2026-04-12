/**
 * CLI token authentication — generate, hash, and verify tokens
 * for the local daemon to authenticate with the server.
 */

import crypto from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { cliTokens } from "../db/schema";

const TOKEN_PREFIX = "knosi_";
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a new CLI token for a user.
 * Returns the raw token (shown once to the user) and the DB record ID.
 */
export async function generateCliToken(userId: string, name = "CLI Daemon") {
  const rawToken = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenH = hashToken(rawToken);

  const [record] = await db
    .insert(cliTokens)
    .values({ userId, tokenHash: tokenH, name })
    .returning({ id: cliTokens.id });

  return { token: rawToken, id: record.id };
}

/**
 * Verify a CLI token and return the associated userId.
 * Returns null if the token is invalid or revoked.
 * Updates lastUsedAt on success.
 */
export async function verifyCliToken(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const tokenH = hashToken(token);

  const [record] = await db
    .select({ id: cliTokens.id, userId: cliTokens.userId })
    .from(cliTokens)
    .where(and(eq(cliTokens.tokenHash, tokenH), isNull(cliTokens.revokedAt)))
    .limit(1);

  if (!record) return null;

  // Update lastUsedAt (fire-and-forget)
  db.update(cliTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(cliTokens.id, record.id))
    .catch(() => {});

  return record.userId;
}
