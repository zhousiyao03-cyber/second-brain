import { z } from "zod/v4";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { usageRecords } from "../db/schema";
import { protectedProcedure, router } from "../trpc";
import type { UsageRecord } from "@/lib/usage-utils";

export const usageRouter = router({
  list: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const rows = await db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.userId, ctx.userId))
        .orderBy(desc(usageRecords.date));

      return rows
        .filter((r) => r.date >= cutoffStr)
        .map(
          (r): UsageRecord => ({
            date: r.date,
            provider: r.provider,
            model: r.model,
            input_tokens: r.inputTokens,
            output_tokens: r.outputTokens,
            cache_read_tokens: r.cacheReadTokens,
            cache_write_tokens: r.cacheWriteTokens,
          }),
        );
    }),
});
