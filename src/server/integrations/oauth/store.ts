import { eq } from "drizzle-orm";
import {
  assertOAuthClientScopeBoundary,
  isAllowedOAuthRedirectUri,
} from "../oauth-clients";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthRefreshTokens,
} from "../../db/schema";
import { OAuthError } from "./types";
import type {
  OAuthAccessTokenRecord,
  OAuthAuthorizationCodeRecord,
  OAuthDbRunner,
  OAuthRefreshTokenRecord,
  OAuthServiceDependencies,
  OAuthStore,
} from "./types";

export function createOAuthStore(runner: OAuthDbRunner): OAuthStore {
  return {
    async findAuthorizationCodeByHash(hash: string) {
      const [row] = (await runner
        .select({
          id: oauthAuthorizationCodes.id,
          userId: oauthAuthorizationCodes.userId,
          clientId: oauthAuthorizationCodes.clientId,
          redirectUri: oauthAuthorizationCodes.redirectUri,
          codeHash: oauthAuthorizationCodes.codeHash,
          codePreview: oauthAuthorizationCodes.codePreview,
          codeChallenge: oauthAuthorizationCodes.codeChallenge,
          codeChallengeMethod: oauthAuthorizationCodes.codeChallengeMethod,
          scopes: oauthAuthorizationCodes.scopes,
          expiresAt: oauthAuthorizationCodes.expiresAt,
          approvedAt: oauthAuthorizationCodes.approvedAt,
          consumedAt: oauthAuthorizationCodes.consumedAt,
          createdAt: oauthAuthorizationCodes.createdAt,
          updatedAt: oauthAuthorizationCodes.updatedAt,
        })
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.codeHash, hash))
        .limit(1)) as OAuthAuthorizationCodeRecord[];

      return row ?? null;
    },
    async insertAuthorizationCode(record) {
      await runner.insert(oauthAuthorizationCodes).values(record);
    },
    async updateAuthorizationCode(id, patch) {
      await runner
        .update(oauthAuthorizationCodes)
        .set(patch)
        .where(eq(oauthAuthorizationCodes.id, id));
    },
    async findRefreshTokenByHash(hash: string) {
      const [row] = (await runner
        .select({
          id: oauthRefreshTokens.id,
          userId: oauthRefreshTokens.userId,
          clientId: oauthRefreshTokens.clientId,
          tokenHash: oauthRefreshTokens.tokenHash,
          tokenPreview: oauthRefreshTokens.tokenPreview,
          scopes: oauthRefreshTokens.scopes,
          expiresAt: oauthRefreshTokens.expiresAt,
          revokedAt: oauthRefreshTokens.revokedAt,
          createdAt: oauthRefreshTokens.createdAt,
          updatedAt: oauthRefreshTokens.updatedAt,
        })
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hash))
        .limit(1)) as OAuthRefreshTokenRecord[];

      return row ?? null;
    },
    async insertRefreshToken(record) {
      await runner.insert(oauthRefreshTokens).values(record);
    },
    async updateRefreshToken(id, patch) {
      await runner
        .update(oauthRefreshTokens)
        .set(patch)
        .where(eq(oauthRefreshTokens.id, id));
    },
    async findAccessTokenByHash(hash: string) {
      const [row] = (await runner
        .select({
          id: oauthAccessTokens.id,
          userId: oauthAccessTokens.userId,
          clientId: oauthAccessTokens.clientId,
          refreshTokenId: oauthAccessTokens.refreshTokenId,
          tokenHash: oauthAccessTokens.tokenHash,
          tokenPreview: oauthAccessTokens.tokenPreview,
          scopes: oauthAccessTokens.scopes,
          expiresAt: oauthAccessTokens.expiresAt,
          revokedAt: oauthAccessTokens.revokedAt,
          createdAt: oauthAccessTokens.createdAt,
          updatedAt: oauthAccessTokens.updatedAt,
        })
        .from(oauthAccessTokens)
        .where(eq(oauthAccessTokens.tokenHash, hash))
        .limit(1)) as OAuthAccessTokenRecord[];

      return row ?? null;
    },
    async insertAccessToken(record) {
      await runner.insert(oauthAccessTokens).values(record);
    },
    async updateAccessToken(id, patch) {
      await runner
        .update(oauthAccessTokens)
        .set(patch)
        .where(eq(oauthAccessTokens.id, id));
    },
    async findAccessTokensByRefreshTokenId(refreshTokenId: string) {
      return (await runner
        .select({
          id: oauthAccessTokens.id,
          userId: oauthAccessTokens.userId,
          clientId: oauthAccessTokens.clientId,
          refreshTokenId: oauthAccessTokens.refreshTokenId,
          tokenHash: oauthAccessTokens.tokenHash,
          tokenPreview: oauthAccessTokens.tokenPreview,
          scopes: oauthAccessTokens.scopes,
          expiresAt: oauthAccessTokens.expiresAt,
          revokedAt: oauthAccessTokens.revokedAt,
          createdAt: oauthAccessTokens.createdAt,
          updatedAt: oauthAccessTokens.updatedAt,
        })
        .from(oauthAccessTokens)
        .where(eq(oauthAccessTokens.refreshTokenId, refreshTokenId))) as OAuthAccessTokenRecord[];
    },
  };
}

async function getDefaultOAuthStore() {
  const { db } = await import("../../db/index");
  return createOAuthStore(db as unknown as OAuthDbRunner);
}

export async function getStore(dependencies: OAuthServiceDependencies = {}) {
  return dependencies.store ?? (await getDefaultOAuthStore());
}

export async function ensureClientAndRedirectUri(
  clientId: string,
  redirectUri: string,
  scopes: readonly string[] | string
) {
  await assertOAuthClientScopeBoundary(clientId, scopes);
  if (!(await isAllowedOAuthRedirectUri(clientId, redirectUri))) {
    throw new OAuthError(
      "invalid_redirect_uri",
      `Redirect URI is not allowed for client ${clientId}.`
    );
  }
}
