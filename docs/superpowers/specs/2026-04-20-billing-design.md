# Knosi Paid Subscription — Design Spec

**Date:** 2026-04-20
**Author:** Zhou Siyao (brainstorm with Claude)
**Status:** Approved for implementation planning
**Scope:** Monetize the hosted `knosi.xyz` deployment via a Free / Pro tier while keeping the open-source self-hosted distribution fully featured.

---

## 1. Context & Goals

Knosi is currently an AGPL-3.0 open-source personal knowledge platform. A hosted deployment runs at `knosi.xyz`. This spec adds a paid subscription layer targeted **only at the hosted deployment**; self-hosters continue to run the full feature set for free.

**Non-goals (explicitly out of scope for v1):**

- Team / multi-user plans
- Coupons, promo codes, or referral programs
- Self-serve refund flow (handled via email + Lemon Squeezy portal)
- Custom invoice fields beyond what Lemon Squeezy provides
- Closing the source or dual-licensing — Knosi stays AGPL-3.0

**Strategy rationale (for future reference):** AGPL + hosted SaaS is the standard playbook (Plausible, Cal.com, Supabase, Ghost, Discourse, GitLab). Open source is a marketing/trust channel, not a revenue threat. Typical ratio is < 1% of users self-host; the rest pay for convenience or don't use it. Closing source would eliminate our positioning ("Turn your Claude tokens into a second brain you actually own"), kill organic developer traffic, and solve nothing that AGPL + hosted doesn't already solve.

---

## 2. Plan Shape (Free vs Pro)

Combo pack — one Pro tier that bundles quota and module access. Single upgrade decision for the user.

| Dimension | Free | Pro |
|---|---|---|
| Ask AI calls per day | 20 | 80 |
| Notes | 50 | Unlimited |
| Image storage | 100 MB | 10 GB |
| Share links | 3 | Unlimited |
| Portfolio Tracker | 🔒 | ✅ |
| Focus Tracker | 🔒 | ✅ |
| OSS Projects | 🔒 | ✅ |
| Claude Capture (MCP + CLI) | 🔒 | ✅ |
| Learning Notebooks | ✅ | ✅ |
| Knosi-hosted AI (no setup) | ❌ | ✅ |
| Priority support | ❌ | ✅ |

**Pricing:**

- Pro Monthly: **$9 / month**
- Pro Annual: **$90 / year** (~17% discount)
- **7-day signup trial**, no credit card required, derived from `user.createdAt` (not an LS-native trial)

**Grandfather clause:** Existing `knosi.xyz` users at billing launch get a one-time **30-day Pro grace window** (independent of the 7-day signup trial). After the window, their data remains accessible per Section 6 rules.

---

## 3. Architecture: Hosted Mode vs Self-Hosted

### 3.1 Deployment isolation

One codebase, one Docker image, one database schema. Hosted features are gated behind a single runtime flag:

```bash
KNOSI_HOSTED_MODE=true   # only set on knosi.xyz's .env.production
```

**Invariants:**

1. `KNOSI_HOSTED_MODE !== "true"` (self-hosted): entitlement checks unconditionally return `PRO_UNLIMITED`. Billing routes, webhook endpoints, and pricing pages return 404.
2. `KNOSI_HOSTED_MODE === "true"` (hosted): entitlements are derived from the `subscriptions` table. Users without a subscription are Free.
3. Migrations are shared. Billing tables exist in self-hosted databases but stay empty and unqueried.

**Alternative modes considered and rejected:**

- Build-time `BUILD_TARGET=saas\|oss` flag — rejected: CI complexity, harder to dogfood SaaS locally.
- Domain check (`if host === 'knosi.xyz'`) — rejected: hardcodes domain, fails for staging / custom subdomains.

### 3.2 Key modules (new)

```
src/server/billing/
  mode.ts                  # isHostedMode() — single source of truth
  entitlements.ts          # getEntitlements(userId) + deriveEntitlements()
  quota.ts                 # assertCanCreate(ctx, resource, delta)
  subscriptions.ts         # DB read/write helpers
  lemonsqueezy/
    client.ts              # LS API wrapper
    webhook.ts             # HMAC verify + event dispatch
    checkout.ts            # Create checkout session
  ai-providers/
    hosted.ts              # Codex account-pool dispatcher + fallback chain
src/app/api/
  webhooks/lemon-squeezy/route.ts
  billing/checkout/route.ts
src/app/(app)/
  pricing/page.tsx          # Public, unauthenticated-accessible
  settings/billing/page.tsx # Authenticated
```

---

## 4. Data Model

### 4.1 New tables

#### `subscriptions`

One row per user. LS allows only one active subscription per customer; variant changes (monthly ↔ annual) are updates, not new rows.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `crypto.randomUUID()` |
| `user_id` | TEXT FK → users | UNIQUE, `ON DELETE CASCADE` |
| `ls_subscription_id` | TEXT | UNIQUE |
| `ls_customer_id` | TEXT | |
| `ls_variant_id` | TEXT | Distinguishes monthly vs annual |
| `plan` | TEXT | `"pro"` (reserved for future tiers) |
| `status` | TEXT | `on_trial` / `active` / `past_due` / `cancelled` / `expired` / `paused` |
| `current_period_end` | INTEGER (timestamp) | Drives grace-period logic |
| `trial_ends_at` | INTEGER nullable | |
| `cancelled_at` | INTEGER nullable | |
| `renews_at` | INTEGER nullable | |
| `update_url` | TEXT | LS-hosted customer portal URL |
| `created_at` / `updated_at` | INTEGER | |

**Indexes:** `user_id` UNIQUE, `ls_subscription_id` UNIQUE, `status`.

#### `webhook_events`

Idempotency + audit log for Lemon Squeezy webhook calls.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | LS event id — enables `INSERT OR IGNORE` idempotency |
| `event_name` | TEXT | |
| `payload` | TEXT (JSON) | Full LS payload |
| `signature` | TEXT | HMAC header, for audit |
| `received_at` | INTEGER | |
| `processed_at` | INTEGER nullable | null = unprocessed |
| `error` | TEXT nullable | stack trace on failure |

### 4.2 Tables unchanged

- `users` — no `plan` column. Entitlements are derived, not persisted state; avoids dual-write consistency issues between webhook handler and user row.
- `ai_usage` — existing table reused. `checkAiRateLimit` swaps the `AI_DAILY_LIMIT` constant for `ctx.entitlements.limits.askAiPerDay`.
- `notes`, `note_images`, `shares` — quota checks use live `SELECT COUNT(*)` / `SUM(size)`. Denormalized counters rejected as premature given current scale and existing `user_id` indexes.

---

## 5. Entitlement API

### 5.1 Shape

```typescript
type Plan = "free" | "pro";
type Limit = number | "unlimited";

type Entitlements = {
  plan: Plan;
  source:
    | "self-hosted"
    | "hosted-free"
    | "hosted-trial"
    | "hosted-active"
    | "hosted-grace";
  limits: {
    askAiPerDay: Limit;    // free=20, pro=80
    notes: Limit;          // free=50, pro="unlimited"
    storageMB: Limit;      // free=100, pro=10240
    shareLinks: Limit;     // free=3, pro="unlimited"
  };
  features: {
    portfolio: boolean;
    focusTracker: boolean;
    ossProjects: boolean;
    claudeCapture: boolean;
    knosiProvidedAi: boolean;
  };
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  cancelledAt?: number;
};
```

### 5.2 Status → plan mapping

| LS status | `currentPeriodEnd > now` | Resolved |
|---|---|---|
| (no subscription, `createdAt + 7d > now`) | — | `hosted-trial` / Pro |
| (no subscription, `createdAt + 7d <= now`) | — | `hosted-free` / Free |
| `on_trial` | — | `hosted-trial` / Pro |
| `active` | — | `hosted-active` / Pro |
| `cancelled` | ✅ | `hosted-grace` / Pro |
| `cancelled` | ❌ | `hosted-free` / Free |
| `past_due` | within 7 days of due | `hosted-grace` / Pro |
| `past_due` | > 7 days | `hosted-free` / Free |
| `paused` | — | `hosted-free` / Free |
| `expired` | — | `hosted-free` / Free |

The 7-day `past_due` grace matches typical card-expiry friction; LS retries payment up to 4 times over ~14 days, so we absorb a conservative half of that window.

### 5.3 Single entry point

```typescript
// src/server/billing/entitlements.ts
export async function getEntitlements(userId: string): Promise<Entitlements> {
  if (!isHostedMode()) return PRO_UNLIMITED;
  const [user, sub] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get(),
  ]);
  return deriveEntitlements(sub, user, Date.now());
}
```

`deriveEntitlements(sub, user, now)` is a **pure function** — all state → plan mapping lives here. Unit tests cover every row of the status table above.

### 5.4 Caching

- **Per-request**: tRPC middleware populates `ctx.entitlements` once per request.
- **Redis short TTL (60s)**: key `billing:ent:${userId}`. Lowers subscription-table read pressure.
- **Invalidation**: webhook handler calls `invalidateEntitlements(userId)` after successful event processing so upgrades/cancellations take effect immediately.

### 5.5 Enforcement points

Three layers, each minimal:

1. **tRPC middleware `requirePro`** — applied to routers for gated modules (portfolio, focus, oss, capture). Throws `TRPCError(code: "FORBIDDEN", cause: "PRO_REQUIRED")`.
2. **`assertCanCreate(ctx, resource, delta)` helper** — called in `notes.create`, `noteImages.upload`, `shares.create`, Ask AI entry. Throws `TRPCError(code: "FORBIDDEN", cause: "QUOTA_EXCEEDED")` with `{resource, current, limit}` in the message.
3. **AI rate limit** — existing `checkAiRateLimit` switches constant to `ctx.entitlements.limits.askAiPerDay`.

---

## 6. Lemon Squeezy Integration

### 6.1 Checkout flow

```
User clicks "Upgrade" on /pricing
  → POST /api/billing/checkout { variant: "monthly" | "annual" }
    → Server creates LS checkout session via LS API
      - custom_data: { user_id }         ← the userId ↔ subscription bridge
      - success URL: knosi.xyz/settings/billing?status=success
    → Returns { url }, frontend redirects
  → User completes payment on LS-hosted page
  → LS redirects back + fires subscription_created webhook
```

The `custom_data.user_id` field is the **only** mechanism linking a LS subscription to our user. Without it, webhook payloads cannot be attributed.

### 6.2 Webhook flow

```
POST /api/webhooks/lemon-squeezy          (route registered only when hosted)
  1. Verify HMAC-SHA256 using LEMONSQUEEZY_WEBHOOK_SECRET → 401 on failure
  2. Read X-Event-Name, body
  3. INSERT OR IGNORE INTO webhook_events (id = body.meta.event_id, ...)
       - Already existed → LS retry, return 200
       - New row → continue
  4. dispatch(event_name, payload) within a single DB transaction
  5. Success → SET processed_at = now(), return 200
  6. Failure → SET error = stack, return 500 (LS retries per its schedule)
```

**Event → action table:**

| LS event | Server action |
|---|---|
| `subscription_created` | Upsert row; set status / trialEndsAt / periodEnd / updateUrl; invalidate entitlement cache |
| `subscription_updated` | Update variant_id, status, periodEnd |
| `subscription_cancelled` | Set `status=cancelled` + `cancelledAt`; **do not delete row** — grace period uses `current_period_end` |
| `subscription_expired` | Set `status=expired` |
| `subscription_payment_success` | Extend `current_period_end` + `renews_at` |
| `subscription_payment_failed` | Set `status=past_due` |
| `subscription_payment_recovered` | Set `status=active` |
| `subscription_paused` / `_unpaused` | Sync status |

### 6.3 Customer portal

Not self-built. `subscription.update_url` opens the LS-hosted portal where users cancel, swap cards, change monthly↔annual, and download invoices. Saves us PCI compliance, invoice generation, and refund UI.

### 6.4 Trial (not LS-native)

Derived from `user.createdAt`:

```typescript
// inside deriveEntitlements
if (!sub && now < user.createdAt + 7 * 24 * 3600 * 1000) {
  return {
    ...PRO_ENTITLEMENTS,
    source: "hosted-trial",
    trialEndsAt: user.createdAt + 7 * 24 * 3600 * 1000,
  };
}
```

- New hosted users automatically get 7 days of Pro with no action.
- Day 8: auto-revert to Free.
- Existing users at launch have `createdAt` far in the past → they skip this trial and use the 30-day grandfather window (Section 7) instead.

### 6.5 Environment variables

```bash
KNOSI_HOSTED_MODE=true
LEMONSQUEEZY_API_KEY=...
LEMONSQUEEZY_STORE_ID=...
LEMONSQUEEZY_WEBHOOK_SECRET=...
LEMONSQUEEZY_VARIANT_MONTHLY=...
LEMONSQUEEZY_VARIANT_ANNUAL=...
```

Self-hosted deployments leave `KNOSI_HOSTED_MODE` unset; the rest are inert.

### 6.6 Pro AI provider (hosted-only)

**Decision:** Use OpenClaw / Codex GPT-5.4 for the `knosiProvidedAi` feature, preserving existing Codex integration code.

**⚠️ Known accepted risk:** OpenClaw / Codex OAuth is bound to an individual ChatGPT account. Multi-tenant resale likely violates OpenAI's Usage Policies. Account termination would take all Pro users' AI offline simultaneously. The product owner has accepted this risk for v1; mitigations below reduce but do not eliminate it.

**Required mitigations (to ship as part of v1):**

1. **Account pool + deterministic routing**: `KNOSI_CODEX_ACCOUNT_POOL="a,b,c,d,e"`. Route each user's requests to `pool[hash(userId) % pool.length]` so session state stays on one account per user, and pool failures are partial rather than total.
2. **Upstream error monitoring**: increment `billing.ai.upstream_error{account,status}` counter on 429 / 403. Alert when a single account exceeds N errors in 5 minutes.
3. **User-facing naming abstraction**: UI label is always "Knosi AI" — never mention GPT-5.4 or OpenClaw. This preserves optionality to silently swap the upstream provider later.
4. **Graceful degradation**: if all pool accounts return errors, prompt the user with "Knosi AI is temporarily unavailable. Please use Claude Code Daemon or try again later." Never return silent 500s.
5. **Per-user rate limit at Knosi layer**: 80 calls/day enforced at our server, well below any single Codex account's daily cap.

**Provider selection for Pro users** (exposed at `/settings/ai`):

- 🧠 Knosi AI (default for Pro) — hosted Codex pool, no setup
- ⚡ Claude Code Daemon — BYO Claude Pro/Max subscription
- 🔑 OpenAI API — BYO key
- 🖥️ Local (Ollama / LM Studio) — primarily for self-hosters

Free users see only the last three options; the Knosi AI row is disabled with a "Pro feature" tooltip.

---

## 7. UI Surfaces

### 7.1 New pages

**`/pricing`** — Public, SEO-indexable, unauthenticated-accessible.

- Hero: "Start free. Upgrade when you need more."
- Free / Pro comparison table (matches Section 2)
- Monthly ↔ Annual toggle under the Pro card, annual shows "Save 17%"
- CTA: unauthenticated → "Sign up to start" / authenticated → "Upgrade to Pro"
- FAQ: cancellation policy, data retention, self-hosted option

**`/settings/billing`** — Authenticated. Three states:

- **Free / trial expired**: Shows plan name + prominent "Upgrade to Pro" CTA.
- **Trial**: Banner "Your 7-day Pro trial ends in N days", CTA "Continue with Pro".
- **Pro**: Plan + variant + next-bill date + "Manage in billing portal" (links `subscription.update_url`).

Footer: "Questions? Email support@knosi.xyz".

### 7.2 Global UI changes

- **Top-bar upgrade badge**: Free → golden "Upgrade" button; trial → "Trial: N days left" pill; Pro → removed (hover avatar shows "Pro").
- **Trial countdown banner**: shown when trial < 3 days left. Dismissible (localStorage), force-reshow in last 24h.
- **First-login onboarding tooltip** (shown once): "You're on a 7-day Pro trial — all features unlocked."
- **Sidebar**: all module links always visible. Pro-only modules show a small lock icon next to the label. Clicking enters the module's `<ProOnly>` gate rather than hiding the route.

### 7.3 New components

**`<ProOnly>`** — wrapping element for gated module landing pages (Portfolio, Focus, OSS Projects, Claude Capture):

```
🔒 {Module} is a Pro feature.
{Short description of what this module does.}
[Upgrade to Pro — $9/mo]  [See what else Pro includes →]
```

**Quota-exceeded modal** — global error boundary catches `TRPCError` with `cause: "QUOTA_EXCEEDED"` or `"PRO_REQUIRED"` and renders:

```
You've hit the Free limit for {resource}.
Current: {current} / {limit} {resource}
Upgrade to Pro for unlimited {resource} + all modules.
[Upgrade — $9/mo]  [Maybe later]
```

### 7.4 Copy rules

- All user-facing text in English (per project CLAUDE.md convention).
- Avoid "limited", "restricted", "blocked". Prefer "Upgrade to unlock", "Pro feature", "Continue with Pro".

---

## 8. Grandfather & Over-Limit Behavior

**Core principle: data is always readable; writes are restricted; export is always available.**

### 8.1 Launch-day existing-user treatment

1. Email announcement: new billing model, 30-day Pro grace window, link to billing/migration docs, link to export, reassurance that Free tier works indefinitely.
2. **30-day full Pro access** (independent of the 7-day signup trial) — a one-time migration window.
3. Day 31: auto-revert to Free. Section 8.2 rules govern over-limit data.
4. Data layer: **never deleted, never hidden**. Notes, images, portfolio positions, focus intervals, capture items all remain visible.

### 8.2 Users with pre-existing data above Free limits

Applies uniformly to grandfathered users, expired-trial users, and Pro-→-Free downgraders.

| Resource | Free limit | Behavior when over |
|---|---|---|
| Notes | 50 | Existing notes fully editable. Creating note #51 throws `QUOTA_EXCEEDED`. |
| Storage | 100 MB | Existing images render normally. New uploads above quota throw `QUOTA_EXCEEDED`. |
| Share links | 3 | Existing links continue to work. Creating a 4th throws `QUOTA_EXCEEDED`. |
| AI calls/day | 20 | Daily call #21 throws `QUOTA_EXCEEDED` with reset-time hint. |
| Pro modules (portfolio, focus, oss, capture) | locked | Existing data becomes **read-only**: list / get procedures work; create / update / delete throw `PRO_REQUIRED`. UI shows "Upgrade to Pro to make changes" banner. |

Checks live in `assertCanCreate` and the `requirePro` middleware — both in `src/server/billing/`. Checks fire **only on creation of new resources**, never on read / edit / delete of existing ones.

### 8.3 Past-due downgrades

After the 7-day `past_due` grace period (Section 5.2) expires:

- Same Section 8.2 rules apply.
- A **red top-banner** reads: "Your payment failed. Update card to restore Pro — [Update in billing portal]".
- Any `subscription_payment_recovered` event restores Pro immediately.

### 8.4 Data export (universal)

`/settings/export` is **unconditionally available** to all users (Free, Pro, downgraded, cancelled). Exports include:

- Full JSON dump (notes + all module data)
- Markdown archive (notes only)

This reinforces the AGPL-derived "you can leave any time" promise — paradoxically the strongest retention mechanic.

---

## 9. Observability & Operations

### 9.1 Metrics (hosted mode only)

| Metric | Type | Purpose |
|---|---|---|
| `billing.webhook.received{event_name}` | counter | Inbound LS events by type |
| `billing.webhook.processed{event_name,status}` | counter | Success / error outcomes |
| `billing.webhook.latency` | histogram | Processing time |
| `billing.checkout.started{variant}` | counter | Upgrade button clicks |
| `billing.checkout.completed{variant}` | counter | Funnel conversion numerator |
| `billing.subscription.state{status}` | gauge | Daily scan of subscriptions table |
| `billing.quota_exceeded{resource}` | counter | Product signal: which limit bites most |
| `billing.ai.upstream_error{account,status}` | counter | Codex account-pool health |
| `billing.ai.cost_estimate{plan}` | counter | Token-based per-user cost estimate |

### 9.2 Alerts (email / push to owner)

- Any `webhook.processed` error → immediate.
- Single Codex account > N 429/403 errors in 5 minutes → probable ban, rotate.
- Single user > $2 of token spend in 24h → anomalous usage.

### 9.3 Structured logging

- Every webhook call logs: `event_id, event_name, user_id, signature_valid, outcome`.
- Every entitlement plan transition logs: `user_id, from_plan, to_plan, reason`.
- Checkout flow uses a correlation ID linking request → LS redirect → webhook.

### 9.4 Operations documentation

- `docs/billing/operations.md` — day-to-day runbook (webhook failure triage, Codex account rotation, refund procedure).
- `docs/billing/migration.md` — user-facing migration guide; linked from launch email.

---

## 10. Testing Strategy

### 10.1 Unit (Vitest)

Primary target: `deriveEntitlements(sub, user, now)` — pure function.

Full state matrix (one test each):

```
[no sub, createdAt 3 days ago]              → hosted-trial / Pro
[no sub, createdAt 8 days ago]              → hosted-free / Free
[status=on_trial]                           → hosted-trial / Pro
[status=active]                             → hosted-active / Pro
[status=cancelled, periodEnd in future]     → hosted-grace / Pro
[status=cancelled, periodEnd in past]       → hosted-free / Free
[status=past_due, due 5 days ago]           → hosted-grace / Pro
[status=past_due, due 10 days ago]          → hosted-free / Free
[status=paused]                             → hosted-free / Free
[status=expired]                            → hosted-free / Free
[KNOSI_HOSTED_MODE=false]                   → self-hosted / Pro (unconditional)
```

Plus boundary tests for `assertCanCreate` (at-limit, just-over, delta > 1).

### 10.2 Integration (Vitest + in-memory SQLite)

Webhook handler covered with real LS fixture payloads (captured from LS test mode):

- Valid signature → state lands correctly.
- Invalid signature → 401, no DB writes.
- Duplicate `event_id` → idempotent 200, no double-processing.
- Handler exception → `error` column populated, returns 500.
- `subscription_cancelled` → status and `cancelled_at` set, row preserved.
- Out-of-order `created` then `updated` → final state converges.

### 10.3 E2E (Playwright — `e2e/billing.spec.ts`)

Core conversion paths only:

- New signup → sees "7 days Pro trial" banner → Portfolio module accessible.
- Trial expiry (test hook backdates `createdAt`) → module shows `<ProOnly>` → Upgrade → `/pricing`.
- Free user creates note #51 → quota modal appears.
- Free user opens Portfolio → `<ProOnly>` rendered, no management controls.
- Pro user sees "Knosi AI" provider option; Free user does not.

**Not tested in E2E:** real LS checkout flow (requires LS test mode, brittle in CI) — covered by integration tests + manual pre-release checklist.

### 10.4 Pre-launch checklist (LS test mode)

- Create monthly + annual variants in LS test store.
- Manually verify with test card `4242 4242 4242 4242`: successful payment, declined card, user-initiated cancel, variant swap, period-end transition, customer portal flow.
- Expose webhook endpoint via `ngrok` for LS test store; confirm signature verification and idempotency behave.
- Save the 6 corresponding webhook payloads as integration-test fixtures.

---

## 11. Rollout Plan

**Phase 1 — internal dogfood:**

1. Set `KNOSI_HOSTED_MODE=true` in staging only.
2. LS test-mode keys.
3. Owner's account exercises every flow; observe metrics and webhook logs for ≥ 2 weeks.

**Phase 2 — public launch:**

1. Switch to LS production keys.
2. Send migration email to all existing users; 30-day Pro grace window starts.
3. Make `/pricing` public.
4. Monitor conversion funnel, webhook error rates, AI cost estimates daily for first 2 weeks.

---

## 12. Known Risks & Open Questions

| Risk | Mitigation | Status |
|---|---|---|
| OpenClaw / Codex multi-tenant resale violates OpenAI ToS | Account pool + monitoring + graceful degradation + abstract UI naming (Section 6.6) | Accepted by owner |
| LS takes 5% + $0.50 cut (vs Stripe 2.9% + $0.30) | Acceptable for v1; future migration to Stripe possible if scale warrants | Accepted |
| Trial derived from `user.createdAt` can't be refreshed | Documented behavior; existing users use 30-day grandfather window instead | Expected |
| Free tier could be abused (create many accounts for AI quota) | Per-account daily limit + aggregate monitoring + future IP / email-domain heuristics | Monitor post-launch |
| Self-hoster mistakenly sets `KNOSI_HOSTED_MODE=true` | Documented in env examples; billing routes fail loudly without LS keys present | Acceptable |

---

## 13. Summary of Key Decisions

1. **License:** Stay AGPL-3.0. Sell hosted convenience, not code.
2. **Deploy isolation:** Runtime flag `KNOSI_HOSTED_MODE` (not build-time, not domain-based).
3. **Data model:** `subscriptions` + `webhook_events`; entitlements derived, not persisted on user row.
4. **Provider:** Lemon Squeezy (Merchant of Record — handles global tax, invoicing, portal).
5. **Trial:** 7-day signup-derived (not LS-native); no card required.
6. **Grandfather:** One-time 30-day Pro window for existing users at launch.
7. **Over-limit behavior:** Data always readable; only new-resource creation is blocked.
8. **Pro AI:** Knosi-hosted Codex GPT-5.4 via account pool (known ToS risk, owner-accepted).
9. **Downgrade:** Pro modules become read-only, not hidden or deleted.
10. **Export:** Unconditionally available to every user.

---

## Next Step

Proceed to implementation plan via the `superpowers:writing-plans` skill.
