import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import * as oauthModule from "./oauth/index.ts";

const {
  approveAuthorizationCode,
  createPkceCodeChallenge,
  exchangeAuthorizationCode,
  getOAuthTokenPreview,
  hashOAuthToken,
  refreshAccessToken,
  revokeOAuthAccessToken,
  revokeOAuthRefreshToken,
  validateBearerAccessToken,
  verifyPkceCodeVerifier,
  issueAuthorizationCode,
  OAuthError,
  __resetAccessTokenValidationCacheForUnitTest,
} = oauthModule;

test.afterEach(() => {
  __resetAccessTokenValidationCacheForUnitTest();
});

function createMemoryOAuthStore() {
  const authorizationCodes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();

  const clone = (record) => (record ? { ...record } : null);

  return {
    authorizationCodes,
    refreshTokens,
    accessTokens,
    async findAuthorizationCodeByHash(hash) {
      for (const record of authorizationCodes.values()) {
        if (record.codeHash === hash) return clone(record);
      }
      return null;
    },
    async insertAuthorizationCode(record) {
      authorizationCodes.set(record.id, clone(record));
    },
    async updateAuthorizationCode(id, patch) {
      const current = authorizationCodes.get(id);
      if (!current) return;
      authorizationCodes.set(id, { ...current, ...patch });
    },
    async findRefreshTokenByHash(hash) {
      for (const record of refreshTokens.values()) {
        if (record.tokenHash === hash) return clone(record);
      }
      return null;
    },
    async insertRefreshToken(record) {
      refreshTokens.set(record.id, clone(record));
    },
    async updateRefreshToken(id, patch) {
      const current = refreshTokens.get(id);
      if (!current) return;
      refreshTokens.set(id, { ...current, ...patch });
    },
    async findAccessTokenByHash(hash) {
      for (const record of accessTokens.values()) {
        if (record.tokenHash === hash) return clone(record);
      }
      return null;
    },
    async insertAccessToken(record) {
      accessTokens.set(record.id, clone(record));
    },
    async updateAccessToken(id, patch) {
      const current = accessTokens.get(id);
      if (!current) return;
      accessTokens.set(id, { ...current, ...patch });
    },
    async findAccessTokensByRefreshTokenId(refreshTokenId) {
      return [...accessTokens.values()]
        .filter((record) => record.refreshTokenId === refreshTokenId)
        .map(clone);
    },
  };
}

test("PKCE verification matches RFC 7636 vectors", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  assert.equal(createPkceCodeChallenge(verifier), challenge);
  assert.equal(verifyPkceCodeVerifier(verifier, challenge), true);
  assert.equal(verifyPkceCodeVerifier(`${verifier}x`, challenge), false);
});

test("token hashing and preview stay stable", () => {
  const token = "koa_abcdef123456";

  assert.equal(
    hashOAuthToken(token),
    crypto.createHash("sha256").update(token).digest("hex")
  );
  assert.equal(getOAuthTokenPreview(token), "123456");
});

test("authorization code exchange issues refreshable access tokens", async () => {
  const store = createMemoryOAuthStore();
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN12345";
  const challenge = createPkceCodeChallenge(verifier);

  const issued = await issueAuthorizationCode(
    {
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      scopes: ["knowledge:read"],
      codeChallenge: challenge,
    },
    {
      store,
      now: () => new Date("2026-04-12T00:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 1),
    }
  );

  await approveAuthorizationCode(
    { authorizationCode: issued.authorizationCode, userId: "user-1" },
    {
      store,
      now: () => new Date("2026-04-12T00:00:10.000Z"),
    }
  );

  const exchanged = await exchangeAuthorizationCode(
    {
      authorizationCode: issued.authorizationCode,
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      codeVerifier: verifier,
    },
    {
      store,
      now: () => new Date("2026-04-12T00:00:20.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 2),
    }
  );

  assert.equal(exchanged.refreshTokenRecord.userId, "user-1");
  assert.equal(exchanged.accessTokenRecord.refreshTokenId, exchanged.refreshTokenRecord.id);
  assert.equal(exchanged.accessTokenRecord.scopes, "knowledge:read");
  assert.equal(store.refreshTokens.size, 1);
  assert.equal(store.accessTokens.size, 1);

  const refreshed = await refreshAccessToken(
    {
      refreshToken: exchanged.refreshToken,
      clientId: "knosi-cli",
    },
    {
      store,
      now: () => new Date("2026-04-12T00:30:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 3),
    }
  );

  assert.equal(refreshed.refreshTokenId, exchanged.refreshTokenRecord.id);
  assert.equal(refreshed.accessTokenRecord.userId, "user-1");
  assert.equal(refreshed.accessTokenRecord.scopes, "knowledge:read");
  assert.equal(store.accessTokens.size, 2);
});

test("revoking a refresh token also revokes linked access tokens", async () => {
  const store = createMemoryOAuthStore();
  const verifier = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi1234567890";
  const challenge = createPkceCodeChallenge(verifier);

  const issued = await issueAuthorizationCode(
    {
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      scopes: ["knowledge:read", "knowledge:write_inbox"],
      codeChallenge: challenge,
    },
    {
      store,
      now: () => new Date("2026-04-12T00:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 4),
    }
  );

  await approveAuthorizationCode(
    { authorizationCode: issued.authorizationCode, userId: "user-2" },
    {
      store,
      now: () => new Date("2026-04-12T00:00:05.000Z"),
    }
  );

  const exchanged = await exchangeAuthorizationCode(
    {
      authorizationCode: issued.authorizationCode,
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      codeVerifier: verifier,
    },
    {
      store,
      now: () => new Date("2026-04-12T00:00:10.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 5),
    }
  );

  const refreshed = await refreshAccessToken(
    {
      refreshToken: exchanged.refreshToken,
      clientId: "knosi-cli",
    },
    {
      store,
      now: () => new Date("2026-04-12T00:01:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 6),
    }
  );

  assert.equal(await revokeOAuthAccessToken({ accessToken: exchanged.accessToken }, { store }), true);
  assert.equal(await revokeOAuthRefreshToken({ refreshToken: exchanged.refreshToken }, { store }), true);

  await assert.rejects(
    () =>
      validateBearerAccessToken(
        { authorization: `Bearer ${exchanged.accessToken}` },
        { store }
      ),
    (error) => error instanceof OAuthError && error.code === "access_token_revoked"
  );

  await assert.rejects(
    () =>
      validateBearerAccessToken(
        { authorization: `Bearer ${refreshed.accessToken}` },
        { store }
      ),
    (error) => error instanceof OAuthError && error.code === "access_token_revoked"
  );
});

test("bearer validation enforces scopes", async () => {
  const store = createMemoryOAuthStore();
  const verifier = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";
  const challenge = createPkceCodeChallenge(verifier);

  const issued = await issueAuthorizationCode(
    {
      clientId: "anthropic-connector",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      scopes: ["knowledge:read"],
      codeChallenge: challenge,
    },
    {
      store,
      now: () => new Date("2026-04-12T08:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 7),
    }
  );

  await approveAuthorizationCode(
    { authorizationCode: issued.authorizationCode, userId: "user-3" },
    {
      store,
      now: () => new Date("2026-04-12T08:00:05.000Z"),
    }
  );

  const exchanged = await exchangeAuthorizationCode(
    {
      authorizationCode: issued.authorizationCode,
      clientId: "anthropic-connector",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier: verifier,
    },
    {
      store,
      now: () => new Date("2026-04-12T08:00:10.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 8),
    }
  );

  await assert.rejects(
    () =>
      validateBearerAccessToken(
        {
          authorization: `Bearer ${exchanged.accessToken}`,
          requiredScopes: ["knowledge:write_inbox"],
        },
        {
          store,
          now: () => new Date("2026-04-12T08:05:00.000Z"),
        }
      ),
    (error) => error instanceof OAuthError && error.code === "insufficient_scope"
  );
});

test("bearer validation reuses a short-lived cached access token record", async () => {
  const store = createMemoryOAuthStore();
  let accessLookups = 0;
  const originalFindAccessTokenByHash = store.findAccessTokenByHash.bind(store);
  store.findAccessTokenByHash = async (hash) => {
    accessLookups += 1;
    return originalFindAccessTokenByHash(hash);
  };

  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN12345";
  const challenge = createPkceCodeChallenge(verifier);

  const issued = await issueAuthorizationCode(
    {
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      scopes: ["knowledge:read"],
      codeChallenge: challenge,
    },
    {
      store,
      now: () => new Date("2026-04-12T09:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 9),
    }
  );

  await approveAuthorizationCode(
    { authorizationCode: issued.authorizationCode, userId: "user-cache" },
    {
      store,
      now: () => new Date("2026-04-12T09:00:05.000Z"),
    }
  );

  const exchanged = await exchangeAuthorizationCode(
    {
      authorizationCode: issued.authorizationCode,
      clientId: "knosi-cli",
      redirectUri: "http://localhost:6274/oauth/callback",
      codeVerifier: verifier,
    },
    {
      store,
      now: () => new Date("2026-04-12T09:00:10.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 10),
    }
  );

  const now = () => new Date("2026-04-12T09:00:11.000Z");

  const first = await validateBearerAccessToken(
    { authorization: `Bearer ${exchanged.accessToken}` },
    { store, now }
  );
  const second = await validateBearerAccessToken(
    { authorization: `Bearer ${exchanged.accessToken}` },
    { store, now }
  );

  assert.equal(first.userId, "user-cache");
  assert.equal(second.userId, "user-cache");
  assert.equal(accessLookups, 1);
});
