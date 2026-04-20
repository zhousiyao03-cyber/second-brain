import { and, desc, eq, gt, isNull, lt, max, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { generateDailySummary, classifyActivitySessions, generateDailyInsight } from "../ai/focus";
import { db } from "../db";
import {
  activitySessions,
  focusDailySummaries,
  focusDevicePairings,
  focusDevices,
} from "../db/schema";
import { proProcedure, protectedProcedure, router } from "../trpc";
import {
  addDaysToDateString,
  buildDailyStats,
  buildRangeStats,
  buildWeeklyStats,
  getLocalDayRange,
} from "../focus/aggregates";
import {
  createFocusDeviceToken,
  getFocusDeviceTokenPreview,
  hashFocusDeviceToken,
} from "../focus/device-auth";
import {
  createFocusPairingCode,
  getFocusPairingCodePreview,
  getFocusPairingExpiresAt,
  hashFocusPairingCode,
} from "../focus/pairing";
import { enforceFocusRateLimit } from "../focus/rate-limit";

const focusDateInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1).default("UTC"),
});

export const focusRouter = router({
  createPairingCode: proProcedure.mutation(async ({ ctx }) => {
    const rateLimit = await enforceFocusRateLimit({
      scope: "pairing:create",
      key: ctx.userId,
      maxAttempts: 5,
      windowSecs: 15 * 60,
    });
    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Pairing code rate limit reached. Retry in ${rateLimit.retryAfterSecs}s.`,
      });
    }

    const now = new Date();
    const code = createFocusPairingCode();
    const codeHash = hashFocusPairingCode(code);
    const expiresAt = getFocusPairingExpiresAt(now);

    await db
      .update(focusDevicePairings)
      .set({
        expiresAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(focusDevicePairings.userId, ctx.userId),
          isNull(focusDevicePairings.consumedAt),
          gt(focusDevicePairings.expiresAt, now)
        )
      );

    await db.insert(focusDevicePairings).values({
      userId: ctx.userId,
      codeHash,
      codePreview: getFocusPairingCodePreview(code),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }),

  listDevices: protectedProcedure.query(async ({ ctx }) => {
    const devices = await db
      .select({
        id: focusDevices.id,
        deviceId: focusDevices.deviceId,
        name: focusDevices.name,
        tokenPreview: focusDevices.tokenPreview,
        lastSeenAt: focusDevices.lastSeenAt,
        revokedAt: focusDevices.revokedAt,
        createdAt: focusDevices.createdAt,
      })
      .from(focusDevices)
      .where(eq(focusDevices.userId, ctx.userId))
      .orderBy(desc(focusDevices.createdAt));

    return devices;
  }),

  registerDevice: proProcedure
    .input(
      z.object({
        deviceId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(80),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const token = createFocusDeviceToken();
      const tokenHash = hashFocusDeviceToken(token);
      const tokenPreview = getFocusDeviceTokenPreview(token);
      const now = new Date();

      const [existing] = await db
        .select({ id: focusDevices.id })
        .from(focusDevices)
        .where(
          and(
            eq(focusDevices.userId, ctx.userId),
            eq(focusDevices.deviceId, input.deviceId)
          )
        )
        .limit(1);

      const payload = {
        name: input.name,
        tokenHash,
        tokenPreview,
        revokedAt: null,
        updatedAt: now,
      };

      if (existing) {
        await db
          .update(focusDevices)
          .set(payload)
          .where(eq(focusDevices.id, existing.id));
      } else {
        await db.insert(focusDevices).values({
          userId: ctx.userId,
          deviceId: input.deviceId,
          name: input.name,
          tokenHash,
          tokenPreview,
          createdAt: now,
          updatedAt: now,
        });
      }

      return {
        token,
        deviceId: input.deviceId,
        name: input.name,
        tokenPreview,
      };
    }),

  revokeDevice: proProcedure
    .input(z.object({ id: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(focusDevices)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(focusDevices.id, input.id),
            eq(focusDevices.userId, ctx.userId),
            isNull(focusDevices.revokedAt)
          )
        );

      return { revoked: true };
    }),

  dailySessions: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      return buildDailyStats({
        sessions,
        date: input.date,
        timeZone: input.timeZone,
      }).sessions;
    }),

  displaySessions: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      return buildDailyStats({
        sessions,
        date: input.date,
        timeZone: input.timeZone,
      }).displaySessions;
    }),

  /** Combined endpoint: returns both stats and sessions in one DB query */
  dailyFull: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      const daily = buildDailyStats({
        sessions,
        date: input.date,
        timeZone: input.timeZone,
      });

      return {
        stats: {
          totalSecs: daily.totalSecs,
          focusedSecs: daily.focusedSecs,
          spanSecs: daily.spanSecs,
          workHoursSecs: daily.workHoursSecs,
          filteredOutSecs: daily.filteredOutSecs,
          nonWorkBreakdown: daily.nonWorkBreakdown,
          tagBreakdown: daily.tagBreakdown,
          longestStreakSecs: daily.longestStreakSecs,
          appSwitches: daily.appSwitches,
          sessionCount: daily.sessionCount,
          displaySessionCount: daily.displaySessions.length,
        },
        sessions: daily.sessions,
      };
    }),

  dailyStats: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      const daily = buildDailyStats({
        sessions,
        date: input.date,
        timeZone: input.timeZone,
      });

      return {
        totalSecs: daily.totalSecs,
        focusedSecs: daily.focusedSecs,
        spanSecs: daily.spanSecs,
        workHoursSecs: daily.workHoursSecs,
        filteredOutSecs: daily.filteredOutSecs,
        nonWorkBreakdown: daily.nonWorkBreakdown,
        tagBreakdown: daily.tagBreakdown,
        longestStreakSecs: daily.longestStreakSecs,
        appSwitches: daily.appSwitches,
        sessionCount: daily.sessionCount,
        displaySessionCount: daily.displaySessions.length,
      };
    }),

  weeklyStats: protectedProcedure
    .input(
      z.object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone: z.string().min(1).default("UTC"),
      })
    )
    .query(async ({ ctx, input }) => {
      const startRange = getLocalDayRange({
        date: input.weekStart,
        timeZone: input.timeZone,
      }).start;
      const endRange = getLocalDayRange({
        date: addDaysToDateString(input.weekStart, 7),
        timeZone: input.timeZone,
      }).start;

      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, endRange),
            gt(activitySessions.endedAt, startRange)
          )
        )
        .orderBy(activitySessions.startedAt);

      return buildWeeklyStats({
        sessions,
        weekStart: input.weekStart,
        timeZone: input.timeZone,
      });
    }),

  rangeStats: protectedProcedure
    .input(
      z.object({
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        days: z.number().int().min(1).max(120).default(30),
        timeZone: z.string().min(1).default("UTC"),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = addDaysToDateString(input.endDate, -(input.days - 1));
      const startRange = getLocalDayRange({
        date: startDate,
        timeZone: input.timeZone,
      }).start;
      const endRange = getLocalDayRange({
        date: addDaysToDateString(input.endDate, 1),
        timeZone: input.timeZone,
      }).start;

      // Only fetch the columns needed for range aggregation
      const sessions = await db
        .select({
          startedAt: activitySessions.startedAt,
          endedAt: activitySessions.endedAt,
          durationSecs: activitySessions.durationSecs,
          tags: activitySessions.tags,
        })
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, endRange),
            gt(activitySessions.endedAt, startRange)
          )
        )
        .orderBy(activitySessions.startedAt);

      return buildRangeStats({
        sessions,
        startDate,
        days: input.days,
        timeZone: input.timeZone,
      });
    }),

  classifySessions: proProcedure
    .input(focusDateInput)
    .mutation(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const pendingSessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start),
            or(
              eq(activitySessions.ingestionStatus, "pending"),
              isNull(activitySessions.aiSummary)
            )
          )
        );

      if (pendingSessions.length === 0) {
        return { classified: 0 };
      }

      const classifications = await classifyActivitySessions(
        pendingSessions.map((session) => ({
          id: session.id,
          appName: session.appName,
          windowTitle: session.windowTitle,
          browserUrl: session.browserUrl,
          browserPageTitle: session.browserPageTitle,
          browserSearchQuery: session.browserSearchQuery,
          browserSurfaceType: session.browserSurfaceType,
          displayLabel: null,
          tags: session.tags,
          durationSecs: session.durationSecs,
        })),
        { userId: ctx.userId },
      );

      // 批量 UPDATE：用事务包裹，减少单独的写操作开销
      await db.transaction(async (tx) => {
        for (const classification of classifications) {
          await tx
            .update(activitySessions)
            .set({
              aiSummary: classification.summary,
              ingestionStatus: "processed",
              updatedAt: new Date(),
            })
            .where(eq(activitySessions.id, classification.id));
        }
      });

      return { classified: classifications.length };
    }),

  generateSummary: proProcedure
    .input(focusDateInput)
    .mutation(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      const daily = buildDailyStats({
        sessions,
        date: input.date,
        timeZone: input.timeZone,
      });
      if (daily.sessionCount === 0) {
        return { summary: null };
      }

      const summary = await generateDailySummary(
        {
          sessions: daily.displaySessions,
          totalSecs: daily.totalSecs,
          tagBreakdown: daily.tagBreakdown,
          longestStreakSecs: daily.longestStreakSecs,
          appSwitches: daily.appSwitches,
          date: input.date,
        },
        { userId: ctx.userId },
      );

      const [existing] = await db
        .select({ id: focusDailySummaries.id })
        .from(focusDailySummaries)
        .where(
          and(
            eq(focusDailySummaries.userId, ctx.userId),
            eq(focusDailySummaries.date, input.date)
          )
        )
        .limit(1);

      const [sourceUpdated] = await db
        .select({ value: max(activitySessions.updatedAt) })
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        );

      const payload = {
        timezone: input.timeZone,
        totalFocusSecs: daily.totalSecs,
        tagBreakdown: JSON.stringify(daily.tagBreakdown),
        aiAnalysis: summary,
        sourceUpdatedAt: sourceUpdated?.value ?? null,
        generatedAt: new Date(),
        updatedAt: new Date(),
      };

      if (existing) {
        await db
          .update(focusDailySummaries)
          .set(payload)
          .where(eq(focusDailySummaries.id, existing.id));
      } else {
        await db.insert(focusDailySummaries).values({
          userId: ctx.userId,
          date: input.date,
          ...payload,
        });
      }

      return { summary };
    }),

  getDailySummary: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const [summary] = await db
        .select()
        .from(focusDailySummaries)
        .where(
          and(
            eq(focusDailySummaries.userId, ctx.userId),
            eq(focusDailySummaries.date, input.date)
          )
        )
        .limit(1);

      return summary ?? null;
    }),

  summaryStatus: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const [pending] = await db
        .select({ value: max(activitySessions.updatedAt) })
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start),
            or(
              eq(activitySessions.ingestionStatus, "pending"),
              isNull(activitySessions.aiSummary)
            )
          )
        );

      const [summary] = await db
        .select({
          id: focusDailySummaries.id,
          sourceUpdatedAt: focusDailySummaries.sourceUpdatedAt,
          generatedAt: focusDailySummaries.generatedAt,
        })
        .from(focusDailySummaries)
        .where(
          and(
            eq(focusDailySummaries.userId, ctx.userId),
            eq(focusDailySummaries.date, input.date)
          )
        )
        .limit(1);

      return {
        hasPendingInsights: Boolean(pending?.value),
        generatedAt: summary?.generatedAt ?? null,
        sourceUpdatedAt: summary?.sourceUpdatedAt ?? null,
        isSummaryStale:
          summary?.generatedAt && summary?.sourceUpdatedAt
            ? summary.generatedAt < summary.sourceUpdatedAt
            : Boolean(summary?.sourceUpdatedAt && !summary?.generatedAt),
      };
    }),

  dailyInsight: protectedProcedure
    .input(focusDateInput)
    .query(async ({ ctx, input }) => {
      const { start, end } = getLocalDayRange(input);
      const sessions = await db
        .select({
          appName: activitySessions.appName,
          windowTitle: activitySessions.windowTitle,
          browserPageTitle: activitySessions.browserPageTitle,
          browserSurfaceType: activitySessions.browserSurfaceType,
          startedAt: activitySessions.startedAt,
          endedAt: activitySessions.endedAt,
          durationSecs: activitySessions.durationSecs,
          tags: activitySessions.tags,
        })
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            lt(activitySessions.startedAt, end),
            gt(activitySessions.endedAt, start)
          )
        )
        .orderBy(activitySessions.startedAt);

      if (sessions.length === 0) {
        return { insights: [], aiGenerated: false };
      }

      // Build app breakdown
      const appTotals: Record<string, number> = {};
      for (const s of sessions) {
        appTotals[s.appName] = (appTotals[s.appName] ?? 0) + s.durationSecs;
      }
      const topApps = Object.entries(appTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);

      const totalSecs = sessions.reduce((s, x) => s + x.durationSecs, 0);
      const firstSession = sessions[0];
      const lastSession = sessions[sessions.length - 1];

      return generateDailyInsight(
        {
          date: input.date,
          totalSecs,
          sessions,
          topApps,
          firstSessionAt: firstSession.startedAt,
          lastSessionAt: lastSession.endedAt,
        },
        { userId: ctx.userId },
      );
    }),
});
