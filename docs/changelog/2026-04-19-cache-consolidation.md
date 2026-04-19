# 2026-04-19 — Consolidate cache layer (delete dead `NamedCache`, move `redis-cache` into `cache/`)

## Task / Goal

The refactor backlog item was "unify `cache.ts` (in-memory LRU) and
`redis-cache.ts` behind one interface." On audit the problem turned
out to be different from expected:

- `src/server/cache.ts` defined `NamedCache<T>` but **no callers** —
  dead code.
- `src/server/redis-cache.ts` defined `RedisCache<T>` which all three
  cache consumers (`routers/notes.ts`, `routers/todos.ts`,
  `integrations/ai-capture.ts`) use via `cache/instances.ts`.

So there is nothing to unify: there's only one live implementation.
The right action is cleanup — delete the dead code and co-locate
`redis-cache.ts` with its consumers under `cache/`.

## Key Changes

- **Deleted** `src/server/cache.ts` (dead `NamedCache` class — zero
  imports anywhere in `src/`).
- **Moved** `src/server/redis-cache.ts` → `src/server/cache/redis-cache.ts`
  so all cache code lives in one directory (`cache/redis-cache.ts`,
  `cache/instances.ts`, `cache/redis-cache.test.mjs`).
- **Fixed imports** inside the moved file: `./redis` / `./logger` /
  `./metrics` → `../redis` / `../logger` / `../metrics`.
- **Updated** `src/server/cache/instances.ts`: import path
  `from "../redis-cache"` → `from "./redis-cache"`.
- **Updated** `src/server/cache/redis-cache.test.mjs`: import path
  `from "../redis-cache.ts"` → `from "./redis-cache.ts"`, and switched
  `import x from "./…"` to `import * as x from "./…"` (the correct
  ESM form for a module with only named exports).

`RedisCache` itself already handles "Redis not configured" and
"Redis network error" by falling back to the loader directly, so there
was no need for a separate in-memory layer. Consumers keep the same
API (`getOrLoad`, `invalidate`, `invalidateWhere`, `clear`).

## Files Touched

- Deleted: `src/server/cache.ts`
- Moved: `src/server/redis-cache.ts` → `src/server/cache/redis-cache.ts`
  (with its 3 `../` relative imports fixed)
- Modified: `src/server/cache/instances.ts`,
  `src/server/cache/redis-cache.test.mjs`

## Verification

- `pnpm build` → ✅ Next.js builds all routes; all downstream cache
  consumers compile.
- `pnpm lint` (direct `./node_modules/.bin/eslint`) → ✅ 0 errors,
  same 9 pre-existing warnings.
- `./node_modules/.bin/tsx --test src/server/cache/redis-cache.test.mjs`
  → ✅ **1/1 test passes**:
  `RedisCache.invalidateWhere deletes every key under a raw-key prefix`.
- `pnpm test:e2e` → ❌ same pre-existing Windows `EBUSY` failure in
  `e2e/global-setup.ts`, unrelated to this refactor.

## Remaining Risks / Follow-ups

- No behavior change: the only live cache implementation (`RedisCache`)
  moved, but its code was untouched beyond the 3-line import fixup.
- If in-memory caching is ever reintroduced, it should live as
  `src/server/cache/in-memory.ts` alongside `redis-cache.ts` so the
  directory remains the single source for cache concerns.
- The Windows e2e environment bug is the only outstanding item across
  this whole 4-step refactor series.

## Refactor Series Wrap-up

Today's refactor series addressed the architecture review items #1
(split big files) and #3 (unify cache):

| Step | File(s) | Before | After |
|---|---|---|---|
| 1 | `db/schema.ts` | 958 lines in 1 file | 12 domain files |
| 2 | `ai/provider.ts` | 919 lines in 1 file | 8 files by backend |
| 3 | `integrations/oauth.ts` | 789 lines in 1 file | 6 files by layer |
| 4 | Cache layer | `cache.ts` (dead) + stray `redis-cache.ts` | `cache/` directory |

Items #2 (generalize job queue for long-running LLM calls) and #4
(split worker into its own process) are deferred per the review.
