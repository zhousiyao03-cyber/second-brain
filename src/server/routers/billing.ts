import { protectedProcedure, router } from "@/server/trpc";

/**
 * billing.me returns the current user's entitlements.
 *
 * Task 14's trpc.ts fix makes `ctx.entitlements` always defined on
 * protectedProcedure — it falls back to PRO_UNLIMITED when there is no
 * userId (self-hosted / E2E bypass), so no runtime guard is needed here.
 */
export const billingRouter = router({
  me: protectedProcedure.query(({ ctx }) => {
    return ctx.entitlements;
  }),
});
