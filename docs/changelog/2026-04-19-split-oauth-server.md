# 2026-04-19 — Split `integrations/oauth.ts` into layered modules

## Task / Goal

`src/server/integrations/oauth.ts` had grown to 789 lines containing the
whole OAuth2 authorization server in one file — types, crypto helpers,
PKCE, scope arithmetic, record assertions, a validation cache, the
Drizzle store adapter, and all 8 public state-transition flows. Split
it into a `oauth/` directory grouped by layer (types → pure helpers →
policy → persistence → flows → façade).

## Key Changes

- New directory `src/server/integrations/oauth/` with 6 files:
  - `types.ts` — `OAuthError` class, 3 record types (authorization
    code / refresh token / access token), `OAuthStore` interface,
    `OAuthDbRunner`, `OAuthServiceDependencies`, plus the shared
    `getDefaultNow` / `normalizeExpiresAt` helpers.
  - `tokens.ts` — pure crypto: `createOAuth{Authorization,Access,Refresh}Token`,
    `hashOAuthToken`, `getOAuthTokenPreview`, `parseBearerToken`,
    PKCE challenge build/verify.
  - `validation.ts` — the access-token validation cache (5-second TTL)
    with get/set/clear, record assertions (expired, consumed,
    revoked), scope arithmetic (`ensureScopesContain`, `toScopeText`,
    `fromScopeText`, `validateRequiredScopes`), and the unit-test
    reset hook.
  - `store.ts` — Drizzle-backed `OAuthStore` adapter (`createOAuthStore`),
    `getDefaultOAuthStore`, `getStore`, plus `ensureClientAndRedirectUri`.
  - `flows.ts` — the 8 public state transitions:
    `issueAuthorizationCode`, `approveAuthorizationCode`,
    `exchangeAuthorizationCode`, `refreshAccessToken`,
    `revokeOAuthAccessToken`, `revokeOAuthRefreshToken`,
    `validateBearerAccessToken` (plus the private `issueOAuthTokens`
    used by both exchange and refresh).
  - `index.ts` — public re-export barrel, including passthroughs for
    `normalizeOAuthScopes` / `parseOAuthScopes` / `serializeOAuthScopes`
    from the neighboring `oauth-clients` module.
- Deleted the old `src/server/integrations/oauth.ts`.
- Updated the existing test `src/server/integrations/oauth.test.mjs`:
  changed
  `import oauthModule from "./oauth.ts"`
  to
  `import * as oauthModule from "./oauth/index.ts"` (namespace import,
  which is the correct ESM form for a module with named-only exports).

## Files Touched

- Added: `src/server/integrations/oauth/{types,tokens,validation,store,flows,index}.ts`
- Modified: `src/server/integrations/oauth.test.mjs` (import path)
- Deleted: `src/server/integrations/oauth.ts`

No consumer imports under `src/app` / `src/server` changed: every caller
already used `@/server/integrations/oauth` (directory-style).

## Verification

- `pnpm build` → ✅ Next.js builds all routes. All 10 downstream
  consumers of `@/server/integrations/oauth` (validateBearerAccessToken
  across chat/usage/mcp/daemon/ai-captures/oauth token/revoke routes,
  plus the oauth authorize server action) compile.
- `pnpm lint` (direct `./node_modules/.bin/eslint`) → ✅ 0 errors,
  same 9 pre-existing warnings as before the split.
- `./node_modules/.bin/tsx --test src/server/integrations/oauth.test.mjs`
  → ✅ **6/6 tests pass**:
  - `authorization code issue stores only hashes and expiry`
  - `approve authorization code marks record for user`
  - `authorization code exchange issues refreshable access tokens`
  - `revoking a refresh token also revokes linked access tokens`
  - `bearer validation enforces scopes`
  - `bearer validation reuses a short-lived cached access token record`
- `pnpm test:e2e` → ❌ same pre-existing Windows `EBUSY` in
  `e2e/global-setup.ts`, unrelated to this refactor (reproducible on
  `main`).

## Remaining Risks / Follow-ups

- No behavior change: every function body is preserved verbatim; only
  file location and the test's import style changed.
- Windows e2e infrastructure bug remains a separate standing item.
- Next in the refactor series:
  - Unify `cache.ts` (in-memory LRU) and `redis-cache.ts` behind one
    `Cache<T>` interface so call sites stop caring which implementation
    is in play.
