import crypto from "node:crypto";
import {
  normalizeOAuthScopes,
  serializeOAuthScopes,
} from "../oauth-clients";
import {
  createOAuthAccessToken,
  createOAuthAuthorizationCode,
  createOAuthRefreshToken,
  getOAuthTokenPreview,
  hashOAuthToken,
  parseBearerToken,
  verifyPkceCodeVerifier,
} from "./tokens";
import { ensureClientAndRedirectUri, getStore } from "./store";
import {
  assertAccessTokenUsable,
  assertAuthorizationCodeAvailable,
  assertAuthorizationCodeUsable,
  assertRefreshTokenUsable,
  clearCachedAccessTokenValidation,
  ensureScopesContain,
  fromScopeText,
  getCachedAccessTokenValidation,
  setCachedAccessTokenValidation,
  toScopeText,
  validateRequiredScopes,
} from "./validation";
import {
  getDefaultNow,
  normalizeExpiresAt,
  OAuthError,
} from "./types";
import type {
  OAuthAccessTokenRecord,
  OAuthAuthorizationCodeRecord,
  OAuthRefreshTokenRecord,
  OAuthServiceDependencies,
} from "./types";

const DEFAULT_AUTHORIZATION_CODE_TTL_SECS = 10 * 60;
const DEFAULT_ACCESS_TOKEN_TTL_SECS = 24 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECS = 365 * 24 * 60 * 60;

export async function issueAuthorizationCode(
  input: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[] | string;
    codeChallenge: string;
    codeChallengeMethod?: "S256";
    expiresInSecs?: number;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const randomBytes = dependencies.randomBytes ?? crypto.randomBytes;
  const store = await getStore(dependencies);

  await ensureClientAndRedirectUri(input.clientId, input.redirectUri, input.scopes);
  if ((input.codeChallengeMethod ?? "S256") !== "S256") {
    throw new OAuthError(
      "unsupported_code_challenge_method",
      "Only S256 PKCE is supported."
    );
  }

  const authorizationCode = createOAuthAuthorizationCode(randomBytes);
  const nowValue = now();
  const record: OAuthAuthorizationCodeRecord = {
    id: crypto.randomUUID(),
    userId: null,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeHash: hashOAuthToken(authorizationCode),
    codePreview: getOAuthTokenPreview(authorizationCode),
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scopes: toScopeText(input.scopes),
    expiresAt: normalizeExpiresAt(
      nowValue,
      input.expiresInSecs ?? DEFAULT_AUTHORIZATION_CODE_TTL_SECS
    ),
    approvedAt: null,
    consumedAt: null,
    createdAt: nowValue,
    updatedAt: nowValue,
  };

  await store.insertAuthorizationCode(record);

  return {
    authorizationCode,
    authorizationCodeId: record.id,
    expiresAt: record.expiresAt,
  };
}

export async function approveAuthorizationCode(
  input: {
    authorizationCode: string;
    userId: string;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const codeHash = hashOAuthToken(input.authorizationCode);
  const record = await store.findAuthorizationCodeByHash(codeHash);

  if (!record) {
    throw new OAuthError("authorization_code_not_found", "Authorization code not found.");
  }

  assertAuthorizationCodeAvailable(record, now());
  if (record.userId && record.userId !== input.userId) {
    throw new OAuthError(
      "authorization_code_user_mismatch",
      "Authorization code already approved for a different user."
    );
  }

  const approvedAt = now();
  await store.updateAuthorizationCode(record.id, {
    userId: input.userId,
    approvedAt,
    updatedAt: approvedAt,
  });

  return {
    authorizationCodeId: record.id,
    userId: input.userId,
    approvedAt,
  };
}

async function issueOAuthTokens(
  input: {
    userId: string;
    clientId: string;
    scopes: readonly string[] | string;
    accessTokenTtlSecs?: number;
    refreshTokenTtlSecs?: number;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const randomBytes = dependencies.randomBytes ?? crypto.randomBytes;
  const store = await getStore(dependencies);
  const nowValue = now();
  const normalizedScopes = normalizeOAuthScopes(input.scopes);
  const scopesText = normalizedScopes.join(" ");

  const refreshToken = createOAuthRefreshToken(randomBytes);
  const refreshRecord: OAuthRefreshTokenRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    clientId: input.clientId,
    tokenHash: hashOAuthToken(refreshToken),
    tokenPreview: getOAuthTokenPreview(refreshToken),
    scopes: scopesText,
    expiresAt: normalizeExpiresAt(
      nowValue,
      input.refreshTokenTtlSecs ?? DEFAULT_REFRESH_TOKEN_TTL_SECS
    ),
    revokedAt: null,
    createdAt: nowValue,
    updatedAt: nowValue,
  };
  await store.insertRefreshToken(refreshRecord);

  const accessToken = createOAuthAccessToken(randomBytes);
  const accessRecord: OAuthAccessTokenRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    clientId: input.clientId,
    refreshTokenId: refreshRecord.id,
    tokenHash: hashOAuthToken(accessToken),
    tokenPreview: getOAuthTokenPreview(accessToken),
    scopes: scopesText,
    expiresAt: normalizeExpiresAt(
      nowValue,
      input.accessTokenTtlSecs ?? DEFAULT_ACCESS_TOKEN_TTL_SECS
    ),
    revokedAt: null,
    createdAt: nowValue,
    updatedAt: nowValue,
  };

  await store.insertAccessToken(accessRecord);

  return {
    accessToken,
    accessTokenRecord: accessRecord,
    refreshToken,
    refreshTokenRecord: refreshRecord,
  };
}

export async function exchangeAuthorizationCode(
  input: {
    authorizationCode: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    accessTokenTtlSecs?: number;
    refreshTokenTtlSecs?: number;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const codeHash = hashOAuthToken(input.authorizationCode);
  const record = await store.findAuthorizationCodeByHash(codeHash);

  if (!record) {
    throw new OAuthError("authorization_code_not_found", "Authorization code not found.");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_client", "Authorization code client mismatch.");
  }
  if (record.redirectUri !== input.redirectUri) {
    throw new OAuthError("invalid_redirect_uri", "Authorization code redirect URI mismatch.");
  }
  assertAuthorizationCodeUsable(record, now());
  if (!verifyPkceCodeVerifier(input.codeVerifier, record.codeChallenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }

  const approvedAt = record.approvedAt ?? now();
  if (!record.approvedAt || !record.userId) {
    throw new OAuthError("authorization_code_pending", "Authorization code has not been approved.");
  }

  await store.updateAuthorizationCode(record.id, {
    consumedAt: now(),
    approvedAt,
    updatedAt: now(),
  });

  const tokens = await issueOAuthTokens(
    {
      userId: record.userId,
      clientId: record.clientId,
      scopes: record.scopes,
      accessTokenTtlSecs: input.accessTokenTtlSecs,
      refreshTokenTtlSecs: input.refreshTokenTtlSecs,
    },
    dependencies
  );

  return {
    authorizationCodeId: record.id,
    ...tokens,
  };
}

export async function refreshAccessToken(
  input: {
    refreshToken: string;
    clientId: string;
    scopes?: readonly string[] | string;
    accessTokenTtlSecs?: number;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const refreshTokenHash = hashOAuthToken(input.refreshToken);
  const record = await store.findRefreshTokenByHash(refreshTokenHash);

  if (!record) {
    throw new OAuthError("refresh_token_not_found", "Refresh token not found.");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_client", "Refresh token client mismatch.");
  }
  assertRefreshTokenUsable(record, now());

  const requestedScopes = normalizeOAuthScopes(input.scopes ?? record.scopes);
  const grantedScopes = fromScopeText(record.scopes);
  if (!ensureScopesContain(requestedScopes, grantedScopes)) {
    throw new OAuthError(
      "insufficient_scope",
      "Refresh token does not grant the requested scopes."
    );
  }

  const accessToken = createOAuthAccessToken(dependencies.randomBytes ?? crypto.randomBytes);
  const accessRecord: OAuthAccessTokenRecord = {
    id: crypto.randomUUID(),
    userId: record.userId,
    clientId: record.clientId,
    refreshTokenId: record.id,
    tokenHash: hashOAuthToken(accessToken),
    tokenPreview: getOAuthTokenPreview(accessToken),
    scopes: serializeOAuthScopes(requestedScopes),
    expiresAt: normalizeExpiresAt(
      now(),
      input.accessTokenTtlSecs ?? DEFAULT_ACCESS_TOKEN_TTL_SECS
    ),
    revokedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };

  await store.insertAccessToken(accessRecord);

  return {
    accessToken,
    accessTokenRecord: accessRecord,
    refreshTokenId: record.id,
  };
}

export async function revokeOAuthAccessToken(
  input: { accessToken: string },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const tokenHash = hashOAuthToken(input.accessToken);
  const record = await store.findAccessTokenByHash(tokenHash);
  if (!record) return false;
  if (record.revokedAt) return true;

  const revokedAt = now();
  await store.updateAccessToken(record.id, {
    revokedAt,
    updatedAt: revokedAt,
  });
  clearCachedAccessTokenValidation(tokenHash);

  return true;
}

export async function revokeOAuthRefreshToken(
  input: { refreshToken: string },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const tokenHash = hashOAuthToken(input.refreshToken);
  const record = await store.findRefreshTokenByHash(tokenHash);
  if (!record) return false;
  if (!record.revokedAt) {
    const revokedAt = now();
    await store.updateRefreshToken(record.id, {
      revokedAt,
      updatedAt: revokedAt,
    });

    const childAccessTokens = await store.findAccessTokensByRefreshTokenId(record.id);
    for (const accessToken of childAccessTokens) {
      if (accessToken.revokedAt) continue;
      await store.updateAccessToken(accessToken.id, {
        revokedAt,
        updatedAt: revokedAt,
      });
      clearCachedAccessTokenValidation(accessToken.tokenHash);
    }
  }

  return true;
}

export async function validateBearerAccessToken(
  input: {
    authorization: string | null;
    requiredScopes?: readonly string[] | string;
  },
  dependencies: OAuthServiceDependencies = {}
) {
  const now = dependencies.now ?? getDefaultNow;
  const store = await getStore(dependencies);
  const bearerToken = parseBearerToken(input.authorization);

  if (!bearerToken) {
    throw new OAuthError("missing_bearer_token", "Bearer access token is required.");
  }

  const tokenHash = hashOAuthToken(bearerToken);
  const currentTime = now();
  const cachedRecord = getCachedAccessTokenValidation(tokenHash, currentTime);
  const record = cachedRecord ?? (await store.findAccessTokenByHash(tokenHash));
  if (!record) {
    throw new OAuthError("access_token_not_found", "Access token not found.");
  }

  assertAccessTokenUsable(record, currentTime);
  validateRequiredScopes(record.scopes, input.requiredScopes);
  if (!cachedRecord) {
    setCachedAccessTokenValidation(tokenHash, record, currentTime);
  }

  return {
    ...record,
    scopes: fromScopeText(record.scopes),
  };
}
