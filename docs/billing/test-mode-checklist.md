# LS Test Mode — Pre-launch Checklist

Before flipping `KNOSI_HOSTED_MODE=true` in production, run through every row below using a Lemon Squeezy **test store** with test card `4242 4242 4242 4242`.

## Flows to exercise

| Flow | Trigger | Expected webhook event | Expected DB state |
|---|---|---|---|
| New monthly subscription | Complete checkout with monthly variant | `subscription_created` (status goes `on_trial` then `active`) | `subscriptions` row; `status`, `trial_ends_at`, `renews_at` populated; `ls_variant_id` matches monthly |
| New annual subscription | Same with annual variant | `subscription_created` | Same; `ls_variant_id` matches annual |
| Successful renewal | Manually trigger renewal in LS test dashboard | `subscription_payment_success` | `current_period_end` + `renews_at` advanced; `status=active` |
| Declined card on renewal | Use `4000 0000 0000 0341` (generic decline) at checkout, then trigger renewal | `subscription_payment_failed` | `status=past_due` |
| Card updated → retry succeeds | Update card to `4242...`, trigger retry | `subscription_payment_recovered` | `status=active` |
| Monthly → annual mid-cycle | Switch variant via LS customer portal | `subscription_updated` | `ls_variant_id` changed; period unchanged |
| User cancels | Cancel via portal | `subscription_cancelled` | `status=cancelled`, `cancelled_at` populated, row preserved |
| Period end after cancel | Wait for `current_period_end` to pass | `subscription_expired` | `status=expired` |

## Verification process

For each flow:

1. **Capture the raw webhook payload** from the LS dashboard (or from the `webhook_events.payload` column in your test DB).
2. **Save it** as a JSON fixture under `src/server/billing/lemonsqueezy/__fixtures__/<event_name>.json`, overwriting the skeleton fixtures created in Task 21.
3. **Re-run** `pnpm test:unit` against the real payloads to catch any shape drift between the LS docs and live webhook behavior.
4. **Inspect the subscription row** after each flow — does it match the expected column values?

## Signature verification

Expose the webhook endpoint through `ngrok` (or equivalent tunnel) so the LS test store can reach your local dev server:

```bash
ngrok http 3200
# Configure the LS webhook endpoint to https://<ngrok-id>.ngrok.io/api/webhooks/lemon-squeezy
# Set KNOSI_HOSTED_MODE=true and LEMONSQUEEZY_WEBHOOK_SECRET locally
```

Confirm every captured webhook passes HMAC verification (`verifyLsSignature`) and idempotency (replay the same `event_id` twice, observe the second returns 200 without double-processing).

## Pass criteria

- All 8 flows produce the expected DB state.
- All 8 webhook payloads have been captured and replaced the skeleton fixtures.
- `pnpm test:unit` stays green against the captured fixtures (no shape drift).
- The customer portal link from `subscription.update_url` opens in LS sandbox and exposes Change Payment Method / Cancel.

Only after all rows pass should production keys and `KNOSI_HOSTED_MODE=true` be enabled.
