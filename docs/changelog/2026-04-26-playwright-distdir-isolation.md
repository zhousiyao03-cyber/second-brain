# Playwright webServer distDir isolation

**Date:** 2026-04-26

## Goal

`pnpm test:e2e` had been broken since commit `c5afa2a` (2026-04-15)
introduced a second `webServer` entry. Both `next dev` processes
spawned from `D:\repos\knosi`, sharing the default `distDir` of
`.next/`. Next 16's dev bundler creates an exclusive lockfile at
`<distDir>/dev/lock`, so the two processes raced for the same lock —
one always exited with `Another next dev server is already running`.

## Root cause

`node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js`
acquires a lockfile keyed on `distDir`:

```js
lockfile = await Lockfile.acquireWithRetriesOrExit(
  path.join(distDir, 'lock'), 'next dev', ...
);
```

Two simultaneous `next dev` invocations in the same project directory
inevitably collide unless they are given distinct `distDir` values.

## Fix

- `next.config.ts` now reads `distDir` from `KNOSI_NEXT_DIST_DIR`,
  falling back to the default `.next`. Production builds and ordinary
  `pnpm dev` are unaffected because the env var is unset.
- `playwright.config.ts` sets `KNOSI_NEXT_DIST_DIR=.next-e2e` for the
  default webServer and `.next-e2e-billing` for the billing webServer.
  Each `next dev` gets its own lockfile.
- `.gitignore` adds the two new directories.

## Changes

- `next.config.ts`
- `playwright.config.ts`
- `.gitignore`

## Verification

| Step | Result |
|---|---|
| `pnpm build` | ✅ Compiled successfully (env var unset → default `.next`) |
| `pnpm exec playwright test e2e/settings-ops.spec.ts` | Past the lockfile error. Both `.next-e2e/` and `.next-e2e-billing/` were created on disk (proof both webServers spawned and compiled). |

## Known follow-up: Windows DB-file EBUSY race

After clearing the lockfile collision, a second pre-existing issue
surfaces on Windows: `globalSetup` does `rmSync` on the e2e SQLite
files, but the webServer's `pnpm db:push && next dev` chain already
holds a handle on those files. Windows refuses to unlink open files,
so globalSetup fails with `EBUSY`. Linux/macOS allow unlink-while-open
so the original setup likely works there.

This is unrelated to the lockfile fix and is its own follow-up task.
Probable solutions: (a) replace `rmSync` with `DROP TABLE`-based
reset that doesn't need exclusive file ownership, or (b) move all DB
prep out of `globalSetup` into a `pretest:e2e` script that runs
before `playwright` is invoked at all.
