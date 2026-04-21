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
- Production Turso schema **NOT yet applied** (4 migrations pending)
- E2E `billing.spec.ts` **not yet run green** — verification is part of the rollout

## Remaining risks

1. **Codex multi-tenant ToS risk** (spec §12, owner-accepted) — account pool + monitoring + abstract UI naming in place; account ban would still take all Pro users down.
2. **LS test-mode fixture drift** — skeleton fixtures in `__fixtures__/` need replacement with real captures per `docs/billing/test-mode-checklist.md`.
3. **E2E selectors not CI-verified** — Task 35 spec is structurally sound but selectors (e.g., "New note" button) may need tweaks once run against a live dev server.

## Next steps (human-executable)

### 1. Production Turso schema rollout

Before flipping `KNOSI_HOSTED_MODE=true`, apply all 4 migrations to prod Turso. Use credentials from `.env.turso-prod.local`:

```bash
for f in drizzle/0034_dazzling_exiles.sql drizzle/0035_ancient_jack_flag.sql drizzle/0036_worthless_stranger.sql drizzle/0037_third_changeling.sql; do
  turso db shell <prod-db-name> < "$f"
done
```

Verify:
```bash
turso db shell <prod-db-name> "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('subscriptions', 'webhook_events', 'note_images')"
turso db shell <prod-db-name> "PRAGMA table_info(users)"  # expect created_at + ai_provider_preference
```

### 2. LS test-mode run-through

Follow `docs/billing/test-mode-checklist.md` — run every row against a test store, capture real webhook payloads, replace skeleton fixtures, re-run `pnpm test:unit`.

### 3. Staging rollout (Task 38)

Set on staging:
```bash
KNOSI_HOSTED_MODE=true
LEMONSQUEEZY_API_KEY=<test-key>
LEMONSQUEEZY_STORE_ID=<test-store>
LEMONSQUEEZY_WEBHOOK_SECRET=<test-secret>
LEMONSQUEEZY_VARIANT_MONTHLY=<test-variant-id>
LEMONSQUEEZY_VARIANT_ANNUAL=<test-variant-id>
KNOSI_CODEX_ACCOUNT_POOL=<pool-csv>
```

Deploy with existing `ops/hetzner/deploy.sh`. Observe `webhook_events` and metrics for ≥ 48 hours.

### 4. Production cut-over

- Switch LS keys to production mode.
- Set `KNOSI_BILLING_LAUNCH_DATE` to the cut-over date (enables 30-day grandfather window).
- Send migration email using `docs/billing/migration.md` as the body.
- Make `/pricing` public-facing (already static; add nav link if desired).
- Monitor conversion funnel, webhook errors, and AI cost estimates daily for 2 weeks.
