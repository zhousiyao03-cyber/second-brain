# Knosi Billing — Operations Runbook

Day-to-day playbook for maintaining the billing system after launch. Audience: whoever is on-call for knosi.xyz.

## Where things live

- **Subscription state:** `subscriptions` table (Turso)
- **Webhook audit log:** `webhook_events` table
- **Entitlement cache:** Redis, keys `billing:ent:<userId>` (60s TTL)
- **Codex account pool:** `KNOSI_CODEX_ACCOUNT_POOL` env var (CSV of account names under `~/.openclaw/<name>/`)
- **Metrics:** Exposed via `/api/ops/snapshot` — see `docs/billing/alerts.md` for thresholds

## Common operations

### Rotate a Codex pool account (suspected ban / hitting rate limits)

1. Provision a new Codex auth profile: `claude login` against a fresh ChatGPT Pro account, copy the resulting directory into `~/.openclaw/<new-name>/`.
2. Append `<new-name>` to `KNOSI_CODEX_ACCOUNT_POOL` in production `.env.production`.
3. Optionally remove the suspect account from the list (or leave it — `runWithHostedAi` will rotate past it on 429/403).
4. Restart the app container so env changes take effect.
5. Monitor `billing.ai.upstream_error{account,status}` for the old account — should drop to zero once the pool rotation kicks in (existing users still hashed to that account won't see errors after restart because `pickAccountForUser` re-hashes on the new pool).

### Investigate a failed webhook

1. Find the failing row:
   ```sql
   SELECT id, event_name, received_at, error FROM webhook_events WHERE error IS NOT NULL ORDER BY received_at DESC LIMIT 20;
   ```
2. Read the stored `payload` to understand what LS sent.
3. Decide:
   - **Transient error** (network, DB hiccup): delete the row, then trigger a replay from the LS dashboard. The idempotency check will accept it as new.
   - **Handler bug**: fix the handler, redeploy, delete the row, replay.
   - **Malformed payload** (no `custom_data.user_id`): contact LS support; manually reconcile by writing a `subscriptions` row matching the payload.

### Issue a manual refund

1. Open the customer's subscription in the Lemon Squeezy dashboard.
2. Issue the refund through LS (they handle tax reversal).
3. LS will fire `subscription_payment_failed` or `subscription_cancelled` — our handler picks it up and updates state automatically.
4. If the user asked to cancel + refund via email: reply with the LS confirmation email + let them know access continues until `current_period_end`.

### Manually grant Pro to a user (e.g., customer-success gift)

Insert a seeded row:
```sql
INSERT INTO subscriptions (id, user_id, ls_subscription_id, ls_customer_id, ls_variant_id, plan, status, current_period_end)
VALUES (lower(hex(randomblob(16))), '<user-id>', 'manual-<user-id>', 'manual', 'manual', 'pro', 'active', strftime('%s', '2027-01-01') * 1000);
```
Then invalidate the cache: `redis-cli DEL "billing:ent:<user-id>"`.

Document who/why in your team's audit log.

### Grandfather window expired — bulk-check affected users

Count users transitioning from grace to free on the launch date +30 days:
```sql
SELECT COUNT(*) FROM users WHERE created_at < <launch-ts> AND id NOT IN (SELECT user_id FROM subscriptions);
```

### Cache flush

If a recent code change affected `deriveEntitlements` logic:
```bash
redis-cli --scan --pattern 'billing:ent:*' | xargs redis-cli DEL
```
Users will re-derive on next request (60s at worst before auto-refresh).

## Alerts

See `docs/billing/alerts.md` for the full catalog (metrics → thresholds → responses).

## Ops checklists

### New hire
- [ ] Read `docs/superpowers/specs/2026-04-20-billing-design.md`
- [ ] Read `docs/superpowers/plans/2026-04-20-billing.md` (especially Tasks 19-22 for webhook flow)
- [ ] Review `docs/billing/alerts.md`
- [ ] Spin up LS test mode, run through `docs/billing/test-mode-checklist.md` to feel the flow end-to-end

### Quarterly review
- [ ] Audit `webhook_events` for unprocessed rows older than 24h
- [ ] Review Codex pool health — any accounts with persistent 429/403?
- [ ] Spot-check subscription state vs LS dashboard (pick 5 random active users)
- [ ] Review refund rate and cancellation reasons from LS analytics
