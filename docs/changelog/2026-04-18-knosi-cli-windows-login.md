# 2026-04-18 · Fix `knosi login` crash + URL truncation on Windows

## Task / Goal

`knosi login` on Windows crashed with `spawn xdg-open ENOENT` before any browser could open. Root cause in `packages/cli/src/commands/auth-login.mjs:29`:

1. `openUrl` only branched on `darwin` vs everything-else, so Windows fell through to `xdg-open` — a Linux/freedesktop-only helper that does not exist on Windows.
2. `try/catch` around `spawn` does not catch `ENOENT`, because `child_process.spawn` emits that error asynchronously on the `'error'` event. With no listener attached the default Node behavior is to crash the process as an unhandled error.

## Key Changes

### CLI (`@knosi/cli` 0.2.0 → 0.2.2)

The first pass (`0.2.1`) stopped the `xdg-open` crash but uncovered a second Windows-only bug: the browser now opened, but the authorize URL was truncated to just `?response_type=code`. Because `cmd /c start "" <url>` receives the URL as a plain command-line token (libuv's `QuoteCmdArg` does not wrap args for `&|<>^`), cmd interprets the first `&` between query parameters as a command separator and drops the rest. `0.2.2` caret-escapes those metacharacters before handing the URL to cmd.

- `packages/cli/src/commands/auth-login.mjs` — added a platform-aware `getOpenCommand(platform, url)` helper:
  - `win32` → `cmd /c start "" <url>` with cmd metachars (`&|<>^`) in the URL caret-escaped by the internal `escapeForCmd` helper.
  - `darwin` → `open <url>`
  - everything else → `xdg-open <url>`
  Attached a `.once("error", …)` listener so when the opener binary is missing the CLI now prints the URL as a manual fallback instead of crashing.
- `packages/cli/src/commands/auth-login.test.mjs` — new tests covering the three platform branches of `getOpenCommand` and the `&` caret-escape for a realistic OAuth URL.
- `packages/cli/package.json` — bumped to `0.2.2` and removed the `open` dependency that was declared but never imported anywhere.

## Files Touched

- `packages/cli/src/commands/auth-login.mjs`
- `packages/cli/src/commands/auth-login.test.mjs`
- `packages/cli/package.json`
- `docs/changelog/2026-04-18-knosi-cli-windows-login.md`

## Verification

- `node --test packages/cli/src/commands/auth-login.test.mjs` → 2 tests pass (OAuth URL encoding + platform opener selection).
- `npx eslint packages/cli/src/commands/auth-login.mjs packages/cli/src/commands/auth-login.test.mjs` → clean (no warnings / errors).
- `pnpm lint` script itself fails before ESLint because it shells out to `mkdir -p test-results`, which is a GNU-only flag Windows `cmd` does not accept. That is a pre-existing issue in the root `package.json` and is unrelated to this change.

## Remaining Risks / Follow-up

- The global install at `C:\Users\…\AppData\Roaming\npm\node_modules\@knosi\cli` still holds the old code. To pick up the fix a user needs either:
  - `npm publish` from `packages/cli/` and then `npm install -g @knosi/cli@latest`, or
  - `npm install -g D:\repos\knosi\packages\cli` to install from the repo directly.
- The Windows branch uses `cmd /c start`. URLs that contain literal `%VARNAME%` sequences could theoretically be expanded by cmd, but the CLI only passes OAuth URLs which are already `encodeURIComponent`-escaped (hex pairs like `%3A`), so no matching env var names are produced in practice.
- No production schema changes in this task, so no Turso rollout is required.
