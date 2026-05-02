# Model Provider Refactor — 2026-05-02

Replacing the 6-provider AI routing (local/openai/codex/cursor/claude-code-daemon/knosi-hosted) with a user-managed Provider table + Role table.

## Status

In progress. Branch: `feat/model-provider-refactor`.

## Spec / Plan

- Spec: `docs/superpowers/specs/2026-05-02-model-provider-refactor-design.md`
- Plan: `docs/superpowers/plans/2026-05-02-model-provider-refactor.md`

## Phase 1 — Crypto module

- Added `src/server/ai/crypto.ts` (AES-256-GCM, master key from `KNOSI_SECRET_KEY` env, hex64 or base64 → 32 bytes).
- Added `src/server/ai/crypto.test.ts` (4 active tests + 1 documented skip for missing-key validation).
- Wired `KNOSI_SECRET_KEY=0*64` into both `playwright.config.ts` webServer env blocks (deterministic test value).

### Production secret rollout (PRE-DEPLOY checklist for Phase 8.4)

1. Generate the prod key once:
   ```bash
   openssl rand -hex 32
   ```
2. Add to GitHub Actions secrets:
   ```bash
   gh secret set KNOSI_SECRET_KEY --body=<the hex>
   ```
3. Add to k3s secret on Hetzner (one-time, via SSH):
   ```bash
   ssh knosi
   kubectl -n knosi create secret generic knosi-secret-key \
     --from-literal=KNOSI_SECRET_KEY=<the hex>
   ```
4. Wire it into the Deployment env in `ops/hetzner/deploy.sh` or the k8s manifest.
5. Verify: `kubectl -n knosi get deploy knosi -o yaml | grep -A2 KNOSI_SECRET_KEY`.

### Local dev

Add to `.env.local`:
```
KNOSI_SECRET_KEY=<openssl rand -hex 32 output>
```

Without this set, `pnpm dev` will fail at boot with a clear error message pointing at the env var.

## Verification (running tally — each phase appends)

- Phase 1.1: `KNOSI_SECRET_KEY=0*64 pnpm test:unit src/server/ai/crypto.test.ts` → 4 passed, 1 skipped.
- Phase 1.2: e2e webServer env wired (verified by playwright.config.ts inspection).

## Production Turso rollout

Pending — will run in Phase 8.4 after schema is stable.
