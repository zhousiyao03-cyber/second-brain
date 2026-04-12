import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import {
  assertOAuthClientScopeBoundary,
  isAllowedOAuthRedirectUri,
  normalizeOAuthScopes,
  parseOAuthScopes,
  serializeOAuthScopes,
} from "./oauth-clients";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthRefreshTokens,
} from "../db/schema";

const AUTHORIZATION_CODE_PREFIX = "koa";
const ACCESS_TOKEN_PREFIX = "kat";
const REFRESH_TOKEN_PREFIX = "krt";

const DEFAULT_AUTHORIZATION_CODE_TTL_SECS = 10 * 60;
const DEFAULT_ACCESS_TOKEN_TTL_SECS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECS = 30 * 24 * 60 * 60;

export class OAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

export type OAuthAuthorizationCodeRecord = {
  id: string;
  userId: string | null;
  clientId: string;
  redirectUri: string;
  codeHash: string;
  codePreview: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scopes: string;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthRefreshTokenRecord = {
  id: string;
  userId: string;
  clientId: string;
  tokenHash: string;
  tokenPreview: string;
  scopes: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthAccessTokenRecord = {
  id: string;
  userId: string;
  clientId: string;
  refreshTokenId: string | null;
  tokenHash: string;
  tokenPreview: string;
  scopes: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthStore = {
  findAuthorizationCodeByHash(hash: string): Promise<OAuthAuthorizationCodeRecord | null>;
  insertAuthorizationCode(record: OAuthAuthorizationCodeRecord): Promise<void>;
  updateAuthorizationCode(
    id: string,
    patch: Partial<Omit<OAuthAuthorizationCodeRecord, "id">>
  ): Promise<void>;
  findRefreshTokenByHash(hash: string): Promise<OAuthRefreshTokenRecord | null>;
  insertRefreshToken(record: OAuthRefreshTokenRecord): Promise<void>;
  updateRefreshToken(
    id: string,
    patch: Partial<Omit<OAuthRefreshTokenRecord, "id">>
  ): Promise<void>;
  findAccessTokenByHash(hash: string): Promise<OAuthAccessTokenRecord | null>;
  insertAccessToken(record: OAuthAccessTokenRecord): Promise<void>;
  updateAccessToken(
    id: string,
    patch: Partial<Omit<OAuthAccessTokenRecord, "id">>
  ): Promise<void>;
  findAccessTokensByRefreshTokenId(refreshTokenId: string): Promise<OAuthAccessTokenRecord[]>;
};

type OAuthDbRunner = {
  select: (...args: unknown[]) => {
    from: (table: unknown) => {
      where: (clause: unknown) => Promise<Array<Record<string, unknown>>> & {
        limit: (count: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert: (...args: unknown[]) => {
    values: (value: unknown) => Promise<unknown>;
  };
  update: (...args: unknown[]) => {
    set: (patch: unknown) => {
      where: (clause: unknown) => Promise<unknown>;
    };
  };
};

export type OAuthServiceDependencies = {
  now?: () => Date;
  randomBytes?: typeof crypto.randomBytes;
  store?: OAuthStore;
};

function getDefaultNow() {
  return new Date();
}

function getTokenValue(prefix: string, randomBytes: typeof crypto.randomBytes) {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function createOAuthAuthorizationCode(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(AUTHORIZATION_CODE_PREFIX, randomBytes);
}

export function createOAuthAccessToken(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(ACCESS_TOKEN_PREFIX, randomBytes);
}

export function createOAuthRefreshToken(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(REFRESH_TOKEN_PREFIX, randomBytes);
}

export function hashOAuthToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getOAuthTokenPreview(token: string) {
  return token.slice(-6);
}

function parseBearerToken(authorization: string | null | undefined) {
  const value = authorization?.trim();
  if (!value || !value.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return value.slice("bearer ".length).trim() || null;
}

function isPkceVerifier(verifier: string) {
  return /^[A-Za-z0-9-._~]{43,128}$/.test(verifier);
}

export function createPkceCodeChallenge(verifier: string) {
  const trimmed = verifier.trim();
  if (!isPkceVerifier(trimmed)) {
    throw new OAuthError(
      "invalid_pkce_verifier",
      "PKCE code verifier must be 43-128 characters using the unreserved charset."
    );
  }

  return crypto.createHash("sha256").update(trimmed).digest("base64url");
}

export function verifyPkceCodeVerifier(verifier: string, challenge: string) {
  return createPkceCodeChallenge(verifier) === challenge;
}

function normalizeExpiresAt(now: Date, ttlSecs: number) {
  return new Date(now.getTime() + ttlSecs * 1000);
}

function ensureScopesContain(requiredScopes: readonly string[], grantedScopes: readonly string[]) {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
}

function toScopeText(scopes: readonly string[] | string | null | undefined) {
  return serializeOAuthScopes(scopes ?? []);
}

function fromScopeText(scopes: string) {
  return parseOAuthScopes(scopes);
}

function ensureClientAndRedirectUri(clientId: string, redirectUri: string, scopes: readonly string[] | string) {
  assertOAuthClientScopeBoundary(clientId, scopes);
  if (!isAllowedOAuthRedirectUri(clientId, redirectUri)) {
    throw new OAuthError(
      "invalid_redirect_uri",
      `Redirect URI is not allowed for client ${clientId}.`
    );
  }
}

function assertAuthorizationCodeUsable(record: OAuthAuthorizationCodeRecord, now: Date) {
  assertAuthorizationCodeAvailable(record, now);
  if (!record.userId || !record.approvedAt) {
    throw new OAuthError("authorization_code_pending", "Authorization code has not been approved.");
  }
}

function assertAuthorizationCodeAvailable(record: OAuthAuthorizationCodeRecord, now: Date) {
  if (record.consumedAt) {
    throw new OAuthError("authorization_code_consumed", "Authorization code already used.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("authorization_code_expired", "Authorization code expired.");
  }
}

function assertRefreshTokenUsable(record: OAuthRefreshTokenRecord, now: Date) {
  if (record.revokedAt) {
    throw new OAuthError("refresh_token_revoked", "Refresh token revoked.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("refresh_token_expired", "Refresh token expired.");
  }
}

function assertAccessTokenUsable(record: OAuthAccessTokenRecord, now: Date) {
  if (record.revokedAt) {
    throw new OAuthError("access_token_revoked", "Access token revoked.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("access_token_expired", "Access token expired.");
  }
}

function validateRequiredScopes(
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

async function getDefaultOAuthStore() {
  const { db } = await import("../db/index");
  return createOAuthStore(db as unknown as OAuthDbRunner);
}

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

async function getStore(dependencies: OAuthServiceDependencies = {}) {
  return dependencies.store ?? (await getDefaultOAuthStore());
}

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

  ensureClientAndRedirectUri(input.clientId, input.redirectUri, input.scopes);
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
  const record = await store.findAccessTokenByHash(tokenHash);
  if (!record) {
    throw new OAuthError("access_token_not_found", "Access token not found.");
  }

  assertAccessTokenUsable(record, now());
  validateRequiredScopes(record.scopes, input.requiredScopes);

  return {
    ...record,
    scopes: fromScopeText(record.scopes),
  };
}

export { normalizeOAuthScopes, parseOAuthScopes, serializeOAuthScopes };
