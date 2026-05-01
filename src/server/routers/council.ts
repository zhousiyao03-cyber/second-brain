import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "../db";
import {
  councilChannels,
  councilChannelMessages,
  councilChannelPersonas,
  councilPersonas,
} from "../db/schema/council";
import { and, asc, eq } from "drizzle-orm";
import { ensureDefaultCouncilChannel } from "../council/seeds";

export const councilRouter = router({
  /**
   * Idempotent: returns existing default channel or creates it with 3 preset personas.
   */
  ensureDefaultChannel: protectedProcedure.mutation(async ({ ctx }) => {
    return ensureDefaultCouncilChannel(ctx.userId);
  }),

  getChannel: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(councilChannels)
        .where(
          and(
            eq(councilChannels.id, input.channelId),
            eq(councilChannels.userId, ctx.userId)
          )
        )
        .limit(1);
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const personas = await db
        .select({ persona: councilPersonas })
        .from(councilChannelPersonas)
        .innerJoin(
          councilPersonas,
          eq(councilChannelPersonas.personaId, councilPersonas.id)
        )
        .where(eq(councilChannelPersonas.channelId, input.channelId));

      return {
        channel: rows[0],
        personas: personas.map((p) => p.persona),
      };
    }),

  listMessages: protectedProcedure
    .input(z.object({ channelId: z.string(), limit: z.number().int().positive().max(500).default(200) }))
    .query(async ({ ctx, input }) => {
      // ownership check
      const channel = await db
        .select()
        .from(councilChannels)
        .where(
          and(
            eq(councilChannels.id, input.channelId),
            eq(councilChannels.userId, ctx.userId)
          )
        )
        .limit(1);
      if (channel.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return db
        .select()
        .from(councilChannelMessages)
        .where(eq(councilChannelMessages.channelId, input.channelId))
        .orderBy(asc(councilChannelMessages.createdAt))
        .limit(input.limit);
    }),
});
