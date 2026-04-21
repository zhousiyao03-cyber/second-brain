import { createClient } from "@libsql/client";
const c = createClient({ url: "file:data/second-brain.db" });
const r1 = await c.execute("SELECT id, event_name, processed_at, error as err FROM webhook_events ORDER BY received_at DESC LIMIT 1");
console.log("webhook_events:");
for (const row of r1.rows) console.log(JSON.stringify(row, null, 2));
const r2 = await c.execute("SELECT id, user_id, status, ls_subscription_id, current_period_end FROM subscriptions WHERE user_id='webhook-smoke-user'");
console.log("\nsubscriptions:");
for (const row of r2.rows) console.log(JSON.stringify(row, null, 2));
