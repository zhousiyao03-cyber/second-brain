/**
 * Public façade for the OAuth2 authorization server.
 *
 * Internally the implementation is split into:
 *   types.ts       — OAuthError, record / store / dependency types,
 *                    plus the `getDefaultNow` + `normalizeExpiresAt`
 *                    helpers reused across files
 *   tokens.ts      — token / authorization code generation + hashing +
 *                    PKCE + bearer-header parsing (pure crypto)
 *   validation.ts  — access-token validation cache + record assertions
 *                    (expired/revoked/etc.) + scope arithmetic
 *   store.ts       — Drizzle-backed `OAuthStore` adapter + default
 *                    store bootstrap + client/redirect-URI gate
 *   flows.ts       — the public state transitions
 *                    (issueAuthorizationCode → approve → exchange →
 *                    refresh → revoke, plus validateBearerAccessToken)
 *
 * Callers keep importing from `@/server/integrations/oauth` — this
 * barrel re-exports the same surface that used to live in a single
 * 789-line file.
 */

export { OAuthError } from "./types";
export type {
  OAuthAccessTokenRecord,
  OAuthAuthorizationCodeRecord,
  OAuthRefreshTokenRecord,
  OAuthServiceDependencies,
  OAuthStore,
} from "./types";

export {
  createOAuthAccessToken,
  createOAuthAuthorizationCode,
  createOAuthRefreshToken,
  createPkceCodeChallenge,
  getOAuthTokenPreview,
  hashOAuthToken,
  verifyPkceCodeVerifier,
} from "./tokens";

export { __resetAccessTokenValidationCacheForUnitTest } from "./validation";

export { createOAuthStore } from "./store";

export {
  approveAuthorizationCode,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  refreshAccessToken,
  revokeOAuthAccessToken,
  revokeOAuthRefreshToken,
  validateBearerAccessToken,
} from "./flows";

export {
  normalizeOAuthScopes,
  parseOAuthScopes,
  serializeOAuthScopes,
} from "../oauth-clients";
