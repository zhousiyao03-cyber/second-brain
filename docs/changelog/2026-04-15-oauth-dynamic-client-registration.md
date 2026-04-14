# 2026-04-15 — OAuth Dynamic Client Registration for MCP

## Goal
Claude Code (desktop/CLI) couldn't connect to `https://www.knosi.xyz/api/mcp` because it relies on RFC 7591 Dynamic Client Registration to self-register its `client_id` and ephemeral local redirect URI. The server only supported a static whitelist (`anthropic-connector`, `knosi-cli`).

## Key Changes
- New table `oauth_clients` (id, client_id, client_name, redirect_uris JSON, allowed_scopes, token_endpoint_auth_method, grant_types, timestamps).
- New route `POST /api/oauth/register` — public endpoint that accepts RFC 7591 client metadata and issues a `dyn_<hex>` client_id. Only `token_endpoint_auth_method=none` (PKCE public clients) allowed. Redirect URIs restricted to `https`, `http://localhost|127.0.0.1`, or `claude://`.
- `getOAuthClient` / `isAllowedOAuthRedirectUri` / `assertOAuthClientScopeBoundary` → now **async**, fall through from static map to the `oauth_clients` table.
- All callers awaited: `oauth/authorize/page.tsx`, `oauth/authorize/actions.ts`, `oauth.ts#ensureClientAndRedirectUri`.
- Authorization-server metadata adds `registration_endpoint`.
- Previous commit already added `/.well-known/oauth-protected-resource`.

## Files Touched
- `src/server/db/schema.ts` — `oauthClients` table
- `src/server/integrations/oauth-clients.ts` — async lookup + static fallback
- `src/server/integrations/oauth.ts` — await new async boundary
- `src/app/oauth/authorize/page.tsx`, `actions.ts` — await
- `src/app/api/oauth/register/route.ts` — new
- `src/app/.well-known/oauth-authorization-server/route.ts` — `registration_endpoint`
- `drizzle/0031_motionless_punisher.sql`, `drizzle/meta/0031_snapshot.json`
- `scripts/db/2026-04-15-oauth-clients-schema.sql`
- `scripts/db/apply-2026-04-15-oauth-clients-rollout.mjs`

## Verification
- `pnpm build` → success (0 errors)
- `pnpm lint` → 0 errors, only pre-existing warnings
- `pnpm db:push` → local schema updated
- `node scripts/db/apply-2026-04-15-oauth-clients-rollout.mjs` → production Turso applied, verified `oauth_clients` table + unique index present, row count 0.

## Remaining Risks / Follow-up
- No rate-limit on `/api/oauth/register` yet — anyone can flood the table. Low risk for now (writes only metadata, no user binding), worth adding a per-IP limit before heavy public traffic.
- No UI for listing/revoking registered clients. Manual `DELETE FROM oauth_clients WHERE client_id = ?` in prod for now.
- Need to smoke-test Claude Code connector end-to-end after Vercel deploy.
