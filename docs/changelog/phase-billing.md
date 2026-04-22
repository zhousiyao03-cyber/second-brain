# Phase Billing — Paid Pro Subscription

**Date:** 2026-04-21
**Branch:** `feat/billing`
**Spec:** `docs/superpowers/specs/2026-04-20-billing-design.md`
**Plan:** `docs/superpowers/plans/2026-04-20-billing.md`

## What shipped

Paid Pro tier on hosted knosi.xyz (self-hosted unaffected, AGPL unchanged). One runtime flag `KNOSI_HOSTED_MODE=true` gates all billing code. Entitlements derived as a pure function from a `subscriptions` row + user signup date. Lemon Squeezy handles checkout, portal, PCI, invoicing, VAT. Pro-only AI routes through a Codex account pool with fallback.

### Plan detail

| Dimension | Free | Pro |
|---|---|---|
| Ask AI calls / day | 20 | 80 |
| Notes | 50 | Unlimited |
| Image storage | 100 MB | 10 GB |
| Share links | 3 | Unlimited |
| Portfolio / Focus / OSS / Capture | Read-only | Full |
| Knosi-hosted AI | — | Included |

**Pricing:** $9/mo monthly, $90/yr annual, 7-day signup trial (no card), 30-day Pro grace window for pre-launch users.

## Tasks completed (38 of 39)

| # | Task | Commit |
|---|---|---|
| 1 | Vitest setup | `29a089f` |
| 2 | `KNOSI_HOSTED_MODE` flag + env scaffolding | `6cd96f8` |
| 3 | `subscriptions` + `webhook_events` schema | `1e223f1` |
| 4 | **Production Turso rollout — DEFERRED to rollout time** | `bb6ed1a` |
| 5 | `deriveEntitlements` pure function + 11 tests | `27f3386` |
| 6 | `getEntitlements` + Redis cache + `users.created_at` | `8285673` |
| 7 | tRPC `ctx.entitlements` middleware + `proProcedure` | `f828428` |
| 8 | `assertQuota` helper + 5 boundary tests | `8209604` |
| 9 | AI rate limit reads per-user entitlement | `65d7686` |
| 10 | Portfolio router mutations → `proProcedure` | `7944e3f` |
| 11 | Focus router mutations gated | `319337c` |
| 12 | OSS projects router mutations gated | `f24725c` |
| 13 | Claude Capture (MCP + CLI) gated | `321b61a` |
| 14 | Notes `assertQuota` on create + ctx widening fix | `9658c4a` |
| 15 | Image upload + share-link quotas + `note_images` table | `6fdee9d` |
| 16 | Public `/pricing` scaffold | `ae9f685` |
| 17 | Lemon Squeezy SDK client | `7343a41` |
| 18 | `/api/billing/checkout` endpoint | `219b7c9` |
| 19 | Webhook HMAC verify + idempotent persist | `a1873f3` |
| 20 | All 9 LS subscription webhook handlers | `493219c` |
| 21 | Webhook integration tests + 3 fixtures | `b90936b` |
| 22 | `billing.me` tRPC query + `/api/billing/invalidate` | `6a97256` |
| 23 | Codex account pool (`parsePool`, `pickAccountForUser`) + 5 tests | `983d0ec` |
| 24 | `runWithHostedAi` fallback chain + Pro-user routing | `5644d1a` |
| 25 | `/settings` AI provider selector UI + preference column | `90e1501` |
| 26 | Interactive `<PricingTable>` (monthly/annual toggle + checkout) | `32346d6` |
| 27 | `useEntitlements` hook | `636d17d` |
| 28 | `<ProOnly>` gate + read-only fallback on portfolio/focus/projects | `38b9fc7` |
| 29 | Top-bar upgrade badge + trial banner | `49faaa4` |
| 30 | Quota modal + tRPC error interceptor | `be8c23a` |
| 31 | Sidebar lock icons on Pro modules | `281c15a` |
| 32 | `/settings/billing` page + LS portal passthrough | `dc95081` |
| 33 | `/settings/export` unconditional data export (JSON + MD) | `94b4c4e` |
| 34 | Billing metrics + subscription-state gauge cron + alerts doc | `7dced9c` |
| 35 | E2E `billing.spec.ts` (5 tests, separate project on port 3101) | `c5afa2a` |
| 36 | LS test-mode pre-launch checklist | `0a522fd` |
| 37 | Operations runbook + user migration guide | `c9883ba` |
| 38A | 30-day grandfather window for pre-launch users + 4 tests | `5d20bd9` |
| 38 | **Staging rollout verification — pending human execution** | — |

## Files added

- `src/server/billing/` — 10 files (mode, entitlements, quota, subscriptions, LS client/checkout/webhook/handlers + fixtures, AI pool)
- `src/components/billing/` — 5 files (ProOnly, PricingTable, TrialBanner, UpgradeBadge, QuotaModal)
- `src/hooks/use-entitlements.ts`
- `src/app/api/billing/{checkout,invalidate,portal}/route.ts`
- `src/app/api/webhooks/lemon-squeezy/route.ts`
- `src/app/api/export/route.ts`
- `src/app/pricing/page.tsx` (public)
- `src/app/(app)/settings/{billing,export}/page.tsx`, `ai-provider-section.tsx`
- `e2e/billing.spec.ts` + helpers
- Schema: `subscriptions`, `webhook_events`, `note_images` tables; `users.created_at`, `users.ai_provider_preference` columns
- Migrations: `0034_dazzling_exiles`, `0035_ancient_jack_flag`, `0036_worthless_stranger`, `0037_third_changeling`
- `docs/billing/` — `alerts.md`, `operations.md`, `migration.md`, `test-mode-checklist.md`
- `scripts/billing/emit-subscription-gauge.mjs`
- `vitest.config.ts` + 37 unit tests across 5 files

## Verification

- `pnpm build` — green throughout
- `pnpm test:unit` — **37 passed** (entitlements matrix + grandfather window + quota + account pool + webhook integration + hosted AI)
- **Production Turso schema applied 2026-04-22** — all 4 migrations landed on prod DB; verified via `scripts/billing/check-prod-schema.mjs` (3 new tables + 2 new columns present). 12 pre-existing users left with `created_at=NULL` (treated as "ancient" by entitlements, eligible for 30-day grandfather if `KNOSI_BILLING_LAUNCH_DATE` is ever set).
- **Production deploy 2026-04-22** — new image rolled out to K3s (`knosi-55f668445b-8gxcc`). `KNOSI_HOSTED_MODE=true` plus 5 LS vars live in `knosi-env` secret. `/pricing` serves 200 publicly, showing the full pricing table. Node briefly hit DiskPressure during nerdctl build — recovered by pruning buildkit cache (7 GB freed).
- **Production webhook end-to-end verified 2026-04-22** — LS webhook URL switched to `https://www.knosi.xyz/api/webhooks/lemon-squeezy`. A signed `subscription_created` payload targeting an existing prod user returned 200, persisted to `webhook_events` with `error=null`, upserted `subscriptions` with `status=active`, and was cleaned up without leaving test rows. Bad signatures correctly rejected 401.
- E2E `billing.spec.ts` **not yet run green** — structural spec but selectors un-verified against the live server.

## Remaining risks

1. **Codex multi-tenant ToS risk** (spec §12, owner-accepted) — account pool + monitoring + abstract UI naming in place; account ban would still take all Pro users down.
2. **LS test-mode fixture drift** — skeleton fixtures in `__fixtures__/` need replacement with real captures per `docs/billing/test-mode-checklist.md`.
3. **E2E selectors not CI-verified** — Task 35 spec is structurally sound but selectors (e.g., "New note" button) may need tweaks once run against a live dev server.

## Live on production since 2026-04-22

`https://www.knosi.xyz/pricing` is public, checkout buttons hit the real LS API in test mode, and the webhook pipeline is wired end-to-end. Helper scripts used during the rollout live under `scripts/billing/`:

- `apply-prod-migrations.mjs` — applies `0034`-`0037` directly via libsql client (no turso CLI needed). Pass `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` inline.
- `check-prod-schema.mjs` — verifies the 3 new tables and 2 new `users` columns exist.
- `update-ls-webhook.mjs` — lists LS webhooks on the store and updates the callback URL.
- `test-webhook-prod.mjs` — signs + fires a `subscription_created` payload at prod, verifies persistence, cleans up after itself.

## Remaining cut-over tasks (before real money flows)

1. **LS merchant application approval** — `Your application has been received and will be reviewed` on the LS dashboard. Until this clears, LS will reject real payments; checkout buttons fall back to test mode. External dependency, no local work.
2. **Rotate API key and webhook secret.** Both values leaked into this session's chat transcript. Generate a new pair in the LS dashboard, overwrite the prod secret with `kubectl -n knosi create secret ... --dry-run=client -o yaml | kubectl apply -f -` (the deploy.sh flow), roll the deployment.
3. **Set `KNOSI_BILLING_LAUNCH_DATE`** on the day you send the migration email. Opens the 30-day grandfather window for pre-launch users (the 12 users with `created_at=NULL` qualify via the entitlements zero-path).
4. **Configure `KNOSI_CODEX_ACCOUNT_POOL`** before the first Pro user exists, otherwise Ask AI on Pro falls straight to the fallback chain's last step (error toast).
5. **LS test-mode checklist run-through** (`docs/billing/test-mode-checklist.md`) — capture real webhook payloads to replace the skeletons under `src/server/billing/lemonsqueezy/__fixtures__/`.
6. **Send `docs/billing/migration.md` email** to the 12 existing users once steps 1-3 are done.
7. **Monitor** the conversion funnel, webhook error rate, and AI cost daily for the first 2 weeks (dashboards per `docs/billing/alerts.md`).

## Risks still open

1. **Codex multi-tenant ToS** (owner-accepted) — account pool + upstream error monitoring in place; a ban still takes all Pro users down at once.
2. **E2E `billing.spec.ts`** never run against the live server — selectors may need tweaks.
3. **Webhook retry storm** — LS retries 500s indefinitely. If the handler ever throws on real payloads, the DB accumulates duplicates (harmless due to idempotency key) but noise grows. Monitor `billing.webhook.processed status=error`.

## Post-rollout fix 2026-04-22

`Failed to start checkout` surfaced in the browser on the first live attempt — LS returned 401 on the pod's `createCheckout` call. Root cause: `.env.production` had the JWT wrapped in single quotes (`LEMONSQUEEZY_API_KEY='eyJ...'`), and `kubectl create secret --from-env-file` does **not** strip quotes the way a shell `source` would. The pod therefore saw the literal value `'eyJ...'` (length 1037 instead of 1035), and LS rejected it.

Fix: stripped the quotes from the env file, re-applied the secret, rolled the deployment. JWT values don't need quoting — they're base64-URL so have no shell-special characters. Keep all future additions to `.env.production` unquoted.
