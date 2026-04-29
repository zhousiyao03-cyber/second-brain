import { z } from "zod/v4";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAuthBypassEnabled } from "@/server/auth/request-session";
import { db } from "@/server/db";
import { activitySessions, focusDevices } from "@/server/db/schema";
import { getLocalDayRange, buildDailyStats } from "@/server/focus/aggregates";
import { resolveIngestUserId } from "@/server/focus/device-auth";

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

const querySchema = z.object({
  deviceId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().trim().min(1).default("UTC"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    deviceId: url.searchParams.get("deviceId"),
    date: url.searchParams.get("date"),
    timeZone: url.searchParams.get("timeZone") ?? "UTC",
  });

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid query",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const userId = await resolveIngestUserId({
    authorization: request.headers.get("authorization"),
    deviceId: parsed.data.deviceId,
    authBypassEnabled: isAuthBypassEnabled(),
    authBypassUserId: process.env.AUTH_BYPASS_USER_ID ?? "test-user",
    configuredApiKey: process.env.FOCUS_INGEST_API_KEY?.trim(),
    configuredUserId: process.env.FOCUS_INGEST_USER_ID?.trim(),
    getSessionUserId: async () => {
      const session = await auth();
      return session?.user?.id ?? null;
    },
    findDeviceUserId: async ({ deviceId, tokenHash }) => {
      const [device] = await db
        .select({
          id: focusDevices.id,
          userId: focusDevices.userId,
        })
        .from(focusDevices)
        .where(
          and(
            eq(focusDevices.deviceId, deviceId),
            eq(focusDevices.tokenHash, tokenHash),
            isNull(focusDevices.revokedAt)
          )
        )
        .limit(1);

      if (!device) {
        return null;
      }

      await db
        .update(focusDevices)
        .set({
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(focusDevices.id, device.id));

      return device.userId;
    },
  });

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { start, end } = getLocalDayRange(parsed.data);
  const sessions = await db
    .select()
    .from(activitySessions)
    .where(
      and(
        eq(activitySessions.userId, userId),
        lt(activitySessions.startedAt, end),
        gt(activitySessions.endedAt, start)
      )
    )
    .orderBy(activitySessions.startedAt);

  const daily = buildDailyStats({
    sessions,
    date: parsed.data.date,
    timeZone: parsed.data.timeZone,
  });

  return Response.json({
    date: parsed.data.date,
    timeZone: parsed.data.timeZone,
    totalSecs: daily.totalSecs,
    focusedSecs: daily.focusedSecs,
    workHoursSecs: daily.workHoursSecs,
    tagBreakdown: daily.tagBreakdown,
    sessionCount: daily.sessionCount,
    sessions: daily.sessions.map((session) => ({
      sourceSessionId: session.sourceSessionId,
      appName: session.appName,
      windowTitle: session.windowTitle,
      browserUrl: session.browserUrl,
      browserPageTitle: session.browserPageTitle,
      browserHost: session.browserHost,
      browserPath: session.browserPath,
      browserSearchQuery: session.browserSearchQuery,
      browserSurfaceType: session.browserSurfaceType,
      displayLabel: null,
      tags: parseJsonStringArray(session.tags),
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSecs: session.durationSecs,
    })),
    displaySessions: daily.displaySessions.map((session) => ({
      sourceSessionId: session.sourceSessionId,
      appName: session.appName,
      windowTitle: session.windowTitle,
      browserUrl: session.browserUrl,
      browserPageTitle: session.browserPageTitle,
      browserHost: session.browserHost,
      browserPath: session.browserPath,
      browserSearchQuery: session.browserSearchQuery,
      browserSurfaceType: session.browserSurfaceType,
      displayLabel: session.displayLabel,
      tags: parseJsonStringArray(session.tags),
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSecs: session.durationSecs,
      focusedSecs: session.focusedSecs,
      spanSecs: session.spanSecs,
      interruptionCount: session.interruptionCount,
      contextApps: parseJsonStringArray(session.visibleApps),
    })),
    fetchedAt: new Date().toISOString(),
  });
}
