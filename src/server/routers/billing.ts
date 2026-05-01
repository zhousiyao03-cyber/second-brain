import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { invalidateProviderPrefCache } from "@/server/ai/provider/mode";
import { invalidateEntitlements } from "@/server/billing/entitlements";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
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

  /**
   * Store the user's preferred AI provider backend. `null` means "default",
   * which for Pro users resolves to the Knosi-hosted pool and for everyone
   * else falls back to the env-configured provider.
   */
  setAiProviderPreference: protectedProcedure
    .input(
      z.object({
        preference: z
          .enum([
            "knosi-hosted",
            "claude-code-daemon",
            "openai",
            "local",
            "cursor",
          ])
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx as { userId?: string }).userId;
      if (!userId) {
        // Self-hosted / E2E bypass — no user row to update.
        return { ok: true as const };
      }
      await db
        .update(users)
        .set({ aiProviderPreference: input.preference })
        .where(eq(users.id, userId));
      await invalidateEntitlements(userId);
      // Spec §3.3 — drop the per-user provider/model cache so the very
      // next /api/chat call routes against the new preference instead of
      // waiting up to 30s for the TTL to expire.
      invalidateProviderPrefCache(userId);
      return { ok: true as const };
    }),

  /**
   * Read the user's currently-saved provider preference. Used by the
   * daemon-banner so it only renders when the user actually opted into
   * `claude-code-daemon` (spec §3.5 / §3.8). Returns `{ preference: null }`
   * for self-hosted / E2E bypass and unauthenticated reads.
   */
  getAiProviderPreference: protectedProcedure.query(async ({ ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) return { preference: null };
    const [row] = await db
      .select({ preference: users.aiProviderPreference })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { preference: row?.preference ?? null };
  }),

  /**
   * Read the user's currently-saved chat model id. `null` means "use the
   * deployment default". Spec §4.1 / §3.4.
   */
  getAiChatModel: protectedProcedure.query(async ({ ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) return null;
    const [row] = await db
      .select({ model: users.aiChatModel })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.model ?? null;
  }),

  /**
   * Persist the user's chat model id override. `null` resets to the
   * deployment default. Spec §4.1 — free text, capped at 200 chars; we
   * deliberately do not validate against any provider's `/v1/models`
   * (MVP trusts user input and lets the LLM API surface bad ids).
   */
  setAiChatModel: protectedProcedure
    .input(
      z.object({
        model: z.string().trim().min(1).max(200).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx as { userId?: string }).userId;
      if (!userId) {
        // Self-hosted / E2E bypass — no user row to update.
        return { ok: true as const };
      }
      await db
        .update(users)
        .set({ aiChatModel: input.model })
        .where(eq(users.id, userId));
      // Drop cache so the next chat request reflects the change.
      invalidateProviderPrefCache(userId);
      return { ok: true as const };
    }),
});
