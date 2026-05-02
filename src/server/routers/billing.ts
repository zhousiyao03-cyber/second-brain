import { protectedProcedure, router } from "@/server/trpc";

/**
 * billing.me returns the current user's entitlements.
 *
 * The legacy AI provider-preference / chat-model procedures lived here;
 * they have been removed in favor of the new `aiSettings` router (Phase 6.1)
 * which manages user-owned providers + role assignments via the
 * `ai_providers` / `ai_role_assignments` tables.
 */
export const billingRouter = router({
  me: protectedProcedure.query(({ ctx }) => {
    return ctx.entitlements;
  }),
});
