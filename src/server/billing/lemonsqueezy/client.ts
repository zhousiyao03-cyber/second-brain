// src/server/billing/lemonsqueezy/client.ts
import { lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";

let initialised = false;

export function getLemonSqueezyClient() {
  if (!initialised) {
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    if (!apiKey) throw new Error("LEMONSQUEEZY_API_KEY not set");
    lemonSqueezySetup({ apiKey });
    initialised = true;
  }
  return { apiKey: process.env.LEMONSQUEEZY_API_KEY };
}
