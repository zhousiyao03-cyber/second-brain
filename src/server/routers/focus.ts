import { and, desc, eq, gt, isNull, lt, max, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { generateDailySummary, classifyActivitySessions } from "../ai/focus";
import { db } from "../db";
import {
  activitySessions,
  focusDailySummaries,
  focusDevicePairings,
  focusDevices,
} from "../db/schema";
import { protectedProcedure, router } from "../trpc";
import {
  addDaysToDateString,
  buildDailyStats,
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
  createPairingCode: protectedProcedure.mutation(async ({ ctx }) => {
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

  registerDevice: protectedProcedure
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

  revokeDevice: protectedProcedure
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
        categoryBreakdown: daily.categoryBreakdown,
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

  classifySessions: protectedProcedure
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
              isNull(activitySessions.category)
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
          durationSecs: session.durationSecs,
        }))
      );

      for (const classification of classifications) {
        await db
          .update(activitySessions)
          .set({
            category: classification.category,
            aiSummary: classification.summary,
            ingestionStatus: "processed",
            updatedAt: new Date(),
          })
          .where(eq(activitySessions.id, classification.id));
      }

      return { classified: classifications.length };
    }),

  generateSummary: protectedProcedure
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

      const summary = await generateDailySummary({
        sessions: daily.sessions,
        totalSecs: daily.totalSecs,
        categoryBreakdown: daily.categoryBreakdown,
        longestStreakSecs: daily.longestStreakSecs,
        appSwitches: daily.appSwitches,
        date: input.date,
      });

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
        categoryBreakdown: JSON.stringify(daily.categoryBreakdown),
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
              isNull(activitySessions.category),
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
});
