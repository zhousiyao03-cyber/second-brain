// One-off: verify LS credentials by directly creating checkout URLs.
// Usage: node --env-file=.env.local scripts/billing/test-checkout-local.mjs
import { lemonSqueezySetup, createCheckout } from "@lemonsqueezy/lemonsqueezy.js";

lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY });

const storeId = process.env.LEMONSQUEEZY_STORE_ID;
const variantMonthly = process.env.LEMONSQUEEZY_VARIANT_MONTHLY;
const variantAnnual = process.env.LEMONSQUEEZY_VARIANT_ANNUAL;

console.log("env:", { storeId, variantMonthly, variantAnnual, hasApiKey: !!process.env.LEMONSQUEEZY_API_KEY });

for (const [label, variantId] of [["monthly", variantMonthly], ["annual", variantAnnual]]) {
  const { data, error } = await createCheckout(storeId, variantId, {
    checkoutData: { custom: { user_id: "test-user-local" } },
  });
  if (error) {
    console.log(`❌ ${label}: ${error.message}`);
    if (error.cause) console.log("   cause:", JSON.stringify(error.cause, null, 2).slice(0, 800));
  } else {
    console.log(`✅ ${label}: ${data.data.attributes.url}`);
  }
}
