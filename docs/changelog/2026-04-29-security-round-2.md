# 2026-04-29 — security round 2 (auth defaults + SSRF)

Follow-up to `2026-04-29-privacy-fixes.md`. Three more concrete findings from
the audit closed in this commit. The two structural items left over from
round 1 (CLI device flow restructure, OAuth open registration) are still
deferred — they need UX coordination and aren't drop-in fixes.

## Findings being addressed

| ID | Severity | Issue |
|----|----------|-------|
| HIGH | High | `AUTH_SECRET` defaulted to `please-change-this-secret` in `docker-compose.yml` and `change-me-in-production` in the Dockerfile builder stage. Anyone who got an instance up via plain `docker compose up` without a real env was running with a publicly-known JWT signing key — anyone with that key forges sessions for any userId. |
| HIGH | High | `bookmarks.create` / `bookmarks.refetch` accepted any URL string and `fetch-content.ts` fetched it with no protocol/host validation. Authenticated users could point the server at `http://127.0.0.1:11434/...` (Ollama on the same pod), `http://10.0.0.x/...` (k3s internal services), AWS/GCP/Azure metadata, etc. The response body was written into `bookmarks.content` and surfaced back to the same user, making this an exfil-capable SSRF rather than blind. |
| MEDIUM | Medium | Every `process.env.AUTH_BYPASS === "true"` check across the codebase had no `NODE_ENV` guard — a stale env var on a production Hetzner pod (CI secret drift, copied dev `.env`, ConfigMap mistake) silently authenticates every request as the bypass user. |

## Changes

### AUTH_SECRET hardening (HIGH 1)

- **`docker-compose.yml`** — drop `${AUTH_SECRET:-please-change-this-secret}`
  fallback. Required env now; container fails fast at boot if absent.
- **`Dockerfile`** — rename build-time placeholder from
  `change-me-in-production` to `knosi-build-only-placeholder-do-not-use-at-runtime`,
  which is recognized by the runtime guard and rejected if it ever leaks
  into a running production server.
- **`src/lib/auth.ts`** — boot-time `assertProductionAuthSecret()` runs at
  module load. When `NODE_ENV === "production"` and we're NOT inside
  `next build` (`NEXT_PHASE !== "phase-production-build"`), throw if
  `AUTH_SECRET` is absent or matches one of the known dev/build placeholders
  (`change-me-in-production`, `please-change-this-secret`,
  `playwright-auth-secret`, `test-secret`, `local-dev-secret`,
  `knosi-build-only-placeholder-do-not-use-at-runtime`, empty string).

### AUTH_BYPASS production guard (MEDIUM)

- **`src/server/auth/bypass.ts`** (new) — extracted `isAuthBypassEnabled()`
  out of `request-session.ts` so it can be unit-tested without dragging
  next-auth into the test environment. The function returns false
  unconditionally when `NODE_ENV === "production"`.
- **`src/server/auth/request-session.ts`** — re-exports from `./bypass` for
  backwards compat. Unchanged for callers.
- **Replaced bare checks** with the helper in: `src/proxy.ts`,
  `src/server/trpc.ts`, `src/app/api/metrics/route.ts`,
  `src/app/api/jobs/tick/route.ts`, `src/app/api/chat/route.ts`,
  `src/app/api/chat/prepare/route.ts`, `src/app/api/chat/tokens/route.ts`,
  `src/app/api/focus/status/route.ts`, `src/app/api/focus/ingest/route.ts`.

### Bookmarks SSRF (HIGH 2)

- **`src/server/ai/safe-fetch.ts`** (new) — drop-in `safeFetch()` wrapping
  Node's native fetch with three layers:
  1. **Protocol allowlist** — only `http:` and `https:` accepted. `file:`,
     `gopher:`, `ftp:`, `data:`, etc. rejected before any DNS lookup.
  2. **DNS pre-resolution** — `dns.lookup(host, { all: true, verbatim: true })`
     and reject if any A/AAAA record falls in: `0.0.0.0/8`, `10/8`,
     `100.64/10` (CGNAT), `127/8` (loopback), `169.254/16` (link-local +
     cloud IMDS), `172.16/12`, `192.168/16`, `198.18/15` (benchmarking),
     `::1`, `::`, `fe80::/10` (link-local), `fec0::/10` (deprecated
     site-local, may still be routable internally), `fc00::/7`
     (unique-local), and IPv4-mapped forms of all of the above.
  3. **Bounded redirect chain** — `redirect: "manual"` + max 5 hops, each
     hop's `Location` re-validated. Closes the public→private redirect
     bypass.
- **`src/server/ai/fetch-content.ts`** — swap `fetch(url, …)` → `safeFetch(url, …)`,
  catch `SsrfBlockedError` and log at info (not error) so SSRF rejections
  don't pollute error metrics when a user pastes localhost.
- **`src/server/routers/bookmarks.ts`** — add `z.string().url()` to the
  `bookmarks.create` input schema. Cheap pre-screen layer that rejects
  obviously malformed input before tRPC even calls fetchContent.

### What this does NOT close

- DNS rebinding TOCTOU between `dns.lookup` and the actual socket connect.
  A stronger defense uses an `undici` Agent with a `connect:` callback that
  re-checks the resolved socket address. Not applied here because this
  project does not currently take undici as a direct dependency. Open as a
  follow-up if the threat model warrants.

## Files touched

```
Dockerfile
docker-compose.yml
docs/changelog/2026-04-29-security-round-2.md  (this)
src/app/api/chat/prepare/route.ts
src/app/api/chat/route.ts
src/app/api/chat/tokens/route.ts
src/app/api/focus/ingest/route.ts
src/app/api/focus/status/route.ts
src/app/api/jobs/tick/route.ts
src/app/api/metrics/route.ts
src/lib/auth.ts
src/proxy.ts
src/server/ai/fetch-content.ts
src/server/ai/safe-fetch.test.ts                (new — vitest)
src/server/ai/safe-fetch.ts                     (new)
src/server/auth/bypass.test.ts                  (new — vitest)
src/server/auth/bypass.ts                       (new)
src/server/auth/request-session.ts
src/server/routers/bookmarks.ts
src/server/trpc.ts
```

## Verification

- `pnpm build` ✅ green.
- `pnpm lint` ✅ green (0 errors; same 14 pre-existing warnings).
- Unit tests ✅ all passing:
  - `src/server/ai/safe-fetch.test.ts` — 38/38 (IPv4 + IPv6 block/allow
    cases, protocol filter, IP-literal hosts).
  - `src/server/auth/bypass.test.ts` — 5/5 (production guard,
    development/test allowed, env unset, only literal "true" matches).
  - `src/app/privacy-fixes.test.ts` — 8/8 (round-1 contracts still hold).
- `pnpm test:e2e` not run for this commit; the changes are server-side
  config + helper functions, no UI flow. Targeted vitest assertions cover
  the observable contracts.

### Post-deploy operator action

After this commit deploys, **the production environment must have a real
`AUTH_SECRET` set** or the container will refuse to boot. Generate with
`openssl rand -base64 32` and add to the Hetzner `knosi-env` ConfigMap /
Secret. If the production secret is currently the
`please-change-this-secret` default, **rotate it immediately and force all
existing user sessions to re-authenticate** — anyone with that default could
have forged JWTs for any user.

## Schema

No DB schema change.

## Residual risks / follow-ups (still not in this commit)

1. **CLI device flow structural fix** (RFC 8628 device_code/user_code split).
   Round 1 closed the Cloudflare-beacon channel; the structural fix needs
   coordinated changes in `packages/cli/`.
2. **OAuth dynamic client registration** — currently unauthenticated. RFC
   7591 allows it but the consent screen renders attacker-chosen
   `client_name`/`client_uri`/`logo_uri` verbatim, so a phisher can mint a
   "first-party-looking" connector. Needs UX work before locking down.
3. **Search Console cleanup** for any share tokens crawled before round 1
   landed (operator action; not code).
