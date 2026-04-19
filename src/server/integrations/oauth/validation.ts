import {
  normalizeOAuthScopes,
  parseOAuthScopes,
  serializeOAuthScopes,
} from "../oauth-clients";
import { OAuthError } from "./types";
import type {
  OAuthAccessTokenRecord,
  OAuthAuthorizationCodeRecord,
  OAuthRefreshTokenRecord,
} from "./types";

const ACCESS_TOKEN_VALIDATION_CACHE_TTL_MS = 5_000;

type CachedAccessTokenValidation = {
  cacheUntilMs: number;
  record: OAuthAccessTokenRecord;
};

const accessTokenValidationCache = new Map<string, CachedAccessTokenValidation>();

export function getCachedAccessTokenValidation(tokenHash: string, now: Date) {
  const cached = accessTokenValidationCache.get(tokenHash);
  if (!cached) return null;
  if (cached.cacheUntilMs <= now.getTime()) {
    accessTokenValidationCache.delete(tokenHash);
    return null;
  }
  return cached.record;
}

export function setCachedAccessTokenValidation(
  tokenHash: string,
  record: OAuthAccessTokenRecord,
  now: Date
) {
  const cacheUntilMs = Math.min(
    record.expiresAt.getTime(),
    now.getTime() + ACCESS_TOKEN_VALIDATION_CACHE_TTL_MS
  );

  if (cacheUntilMs <= now.getTime()) {
    accessTokenValidationCache.delete(tokenHash);
    return;
  }

  accessTokenValidationCache.set(tokenHash, {
    cacheUntilMs,
    record: { ...record },
  });
}

export function clearCachedAccessTokenValidation(tokenHash: string) {
  accessTokenValidationCache.delete(tokenHash);
}

export function __resetAccessTokenValidationCacheForUnitTest() {
  accessTokenValidationCache.clear();
}

export function assertAuthorizationCodeAvailable(
  record: OAuthAuthorizationCodeRecord,
  now: Date
) {
  if (record.consumedAt) {
    throw new OAuthError("authorization_code_consumed", "Authorization code already used.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("authorization_code_expired", "Authorization code expired.");
  }
}

export function assertAuthorizationCodeUsable(
  record: OAuthAuthorizationCodeRecord,
  now: Date
) {
  assertAuthorizationCodeAvailable(record, now);
  if (!record.userId || !record.approvedAt) {
    throw new OAuthError("authorization_code_pending", "Authorization code has not been approved.");
  }
}

export function assertRefreshTokenUsable(
  record: OAuthRefreshTokenRecord,
  now: Date
) {
  if (record.revokedAt) {
    throw new OAuthError("refresh_token_revoked", "Refresh token revoked.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("refresh_token_expired", "Refresh token expired.");
  }
}

export function assertAccessTokenUsable(
  record: OAuthAccessTokenRecord,
  now: Date
) {
  if (record.revokedAt) {
    throw new OAuthError("access_token_revoked", "Access token revoked.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("access_token_expired", "Access token expired.");
  }
}

export function ensureScopesContain(
  requiredScopes: readonly string[],
  grantedScopes: readonly string[]
) {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
}

export function toScopeText(scopes: readonly string[] | string | null | undefined) {
  return serializeOAuthScopes(scopes ?? []);
}

export function fromScopeText(scopes: string) {
  return parseOAuthScopes(scopes);
}

export function validateRequiredScopes(
  grantedScopes: string,
  requiredScopes: readonly string[] | string | null | undefined
) {
  const normalizedRequired = normalizeOAuthScopes(requiredScopes ?? []);
  if (normalizedRequired.length === 0) return;
  const granted = fromScopeText(grantedScopes);
  if (!ensureScopesContain(normalizedRequired, granted)) {
    throw new OAuthError(
      "insufficient_scope",
      `Token is missing required scopes: ${normalizedRequired.join(" ")}`
    );
  }
}
