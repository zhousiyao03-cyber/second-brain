import crypto from "crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  calculateTotalTokens,
  summarizeTokenUsageEntries,
  TOKEN_USAGE_PROVIDERS,
  type TokenUsageListEntry,
} from "@/lib/token-usage";
import { readWorkspaceLocalTokenUsage } from "@/server/token-usage-local";
import { db } from "../db";
import { tokenUsageEntries } from "../db/schema";
import { publicProcedure, router } from "../trpc";

const tokenUsageCreateInput = z
  .object({
    provider: z.enum(TOKEN_USAGE_PROVIDERS),
    model: z.string().max(120).optional(),
    totalTokens: z.coerce.number().int().min(0).optional(),
    inputTokens: z.coerce.number().int().min(0).optional(),
    outputTokens: z.coerce.number().int().min(0).optional(),
    cachedTokens: z.coerce.number().int().min(0).optional(),
    notes: z.string().max(500).optional(),
    usageAt: z.coerce.date().optional(),
    source: z.enum(["manual", "import"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.totalTokens == null && calculateTotalTokens(value) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "Please provide total tokens or at least one token breakdown field.",
      });
    }
  });

async function getCombinedTokenUsageData() {
  const persistedEntries = await db
    .select()
    .from(tokenUsageEntries)
    .orderBy(desc(tokenUsageEntries.usageAt), desc(tokenUsageEntries.createdAt));

  const persistedListEntries: TokenUsageListEntry[] = persistedEntries.map((entry) => ({
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    totalTokens: entry.totalTokens,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    cachedTokens: entry.cachedTokens ?? 0,
    notes: entry.notes,
    source: entry.source,
    usageAt: entry.usageAt,
    canDelete: true,
  }));

  const localData = readWorkspaceLocalTokenUsage();
  const entries = [...persistedListEntries, ...localData.entries].toSorted((left, right) => {
    return new Date(right.usageAt ?? 0).getTime() - new Date(left.usageAt ?? 0).getTime();
  });

  return {
    entries,
    localSources: localData.localSources,
  };
}

export const tokenUsageRouter = router({
  list: publicProcedure.query(async () => {
    return getCombinedTokenUsageData();
  }),

  overview: publicProcedure.query(async () => {
    const { entries, localSources } = await getCombinedTokenUsageData();

    return {
      ...summarizeTokenUsageEntries(entries),
      localSources,
    };
  }),

  create: publicProcedure
    .input(tokenUsageCreateInput)
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      const usageAt = input.usageAt ?? new Date();
      const inputTokens = input.inputTokens ?? 0;
      const outputTokens = input.outputTokens ?? 0;
      const cachedTokens = input.cachedTokens ?? 0;
      const totalTokens = calculateTotalTokens({
        totalTokens: input.totalTokens,
        inputTokens,
        outputTokens,
        cachedTokens,
      });

      // TODO(task-5): replace with real userId from session
      const userId = "local-dev";
      await db.insert(tokenUsageEntries).values({
        id,
        userId,
        provider: input.provider,
        model: input.model?.trim() || null,
        totalTokens,
        inputTokens,
        outputTokens,
        cachedTokens,
        notes: input.notes?.trim() || null,
        source: input.source ?? "manual",
        usageAt,
        updatedAt: new Date(),
      });

      return { id, totalTokens };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(tokenUsageEntries).where(eq(tokenUsageEntries.id, input.id));
      return { success: true };
    }),
});
