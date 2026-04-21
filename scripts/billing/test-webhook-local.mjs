// One-off: fire a fake LS subscription_created webhook at localhost to verify
// signature verification + persistence wiring end-to-end.
// Usage: node --env-file=.env.local scripts/billing/test-webhook-local.mjs
import crypto from "node:crypto";
import { createClient } from "@libsql/client";

const db = createClient({ url: "file:data/second-brain.db" });
const SMOKE_USER_ID = "webhook-smoke-user";
await db.execute({
  sql: "INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)",
  args: [
    SMOKE_USER_ID,
    "webhook-smoke@example.com",
    "Webhook Smoke",
    Math.floor(Date.now() / 1000),
  ],
});
// Clear any leftover subscription row from a previous run so the test always
// exercises the INSERT path (not ON CONFLICT update).
await db.execute({ sql: "DELETE FROM subscriptions WHERE user_id = ?", args: [SMOKE_USER_ID] });

const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
const storeId = Number(process.env.LEMONSQUEEZY_STORE_ID);
const variantId = Number(process.env.LEMONSQUEEZY_VARIANT_MONTHLY);

const eventId = `test-evt-${Date.now()}`;
const payload = {
  meta: {
    event_name: "subscription_created",
    event_id: eventId,
    custom_data: { user_id: "webhook-smoke-user" },
  },
  data: {
    type: "subscriptions",
    id: `sub-${Date.now()}`,
    attributes: {
      store_id: storeId,
      customer_id: 987654,
      order_id: 111111,
      variant_id: variantId,
      status: "active",
      trial_ends_at: null,
      renews_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      ends_at: null,
      urls: {
        update_payment_method: "https://knosi-ai.lemonsqueezy.com/billing?sub=123",
        customer_portal: "https://knosi-ai.lemonsqueezy.com/billing",
      },
    },
  },
};

const raw = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");

const res = await fetch("http://localhost:3200/api/webhooks/lemon-squeezy", {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature": sig },
  body: raw,
});

console.log("status:", res.status);
console.log("body:", await res.text());
console.log("event_id we sent:", eventId);

// Also confirm bad signature gets rejected.
const badRes = await fetch("http://localhost:3200/api/webhooks/lemon-squeezy", {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature": "deadbeef" },
  body: raw,
});
console.log("\nbad-signature status (expect 401):", badRes.status);
