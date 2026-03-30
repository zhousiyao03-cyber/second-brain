import { z } from "zod/v4";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { activitySessions, focusDevices } from "@/server/db/schema";
import { resolveIngestUserId } from "@/server/focus/device-auth";
import { autoTag } from "@/server/focus/tags";

const sessionSchema = z.object({
  sourceSessionId: z.string().trim().min(1),
  appName: z.string().trim().min(1),
  windowTitle: z.string().trim().nullable().optional(),
  browserUrl: z.string().trim().nullable().optional(),
  browserPageTitle: z.string().trim().nullable().optional(),
  visibleApps: z.array(z.string()).nullable().optional(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
});

const ingestBodySchema = z.object({
  deviceId: z.string().trim().min(1),
  timeZone: z.string().trim().min(1).default("UTC"),
  sessions: z.array(sessionSchema).min(1).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ingestBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid input",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const userId = await resolveIngestUserId({
    authorization: request.headers.get("authorization"),
    deviceId: parsed.data.deviceId,
    authBypassEnabled: process.env.AUTH_BYPASS === "true",
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

  const accepted: string[] = [];
  const rejected: Array<{ sourceSessionId: string; reason: string }> = [];

  for (const session of parsed.data.sessions) {
    if (session.endedAt <= session.startedAt) {
      rejected.push({
        sourceSessionId: session.sourceSessionId,
        reason: "endedAt must be after startedAt",
      });
      continue;
    }

    const durationSecs = Math.max(
      1,
      Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
    );
    const tagsJson = JSON.stringify(
      autoTag({
        appName: session.appName,
        windowTitle: session.windowTitle ?? null,
        browserUrl: session.browserUrl ?? null,
      })
    );
    const visibleAppsJson = session.visibleApps
      ? JSON.stringify(session.visibleApps)
      : null;
    const now = new Date();

    const [existing] = await db
      .select({ id: activitySessions.id })
      .from(activitySessions)
      .where(
        and(
          eq(activitySessions.userId, userId),
          eq(activitySessions.sourceDeviceId, parsed.data.deviceId),
          eq(activitySessions.sourceSessionId, session.sourceSessionId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(activitySessions)
        .set({
          appName: session.appName,
          windowTitle: session.windowTitle ?? null,
          browserUrl: session.browserUrl ?? null,
          browserPageTitle: session.browserPageTitle ?? null,
          visibleApps: visibleAppsJson,
          tags: tagsJson,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSecs,
          ingestionStatus: "pending",
          ingestedAt: now,
          updatedAt: now,
        })
        .where(eq(activitySessions.id, existing.id));
    } else {
      await db.insert(activitySessions).values({
        userId,
        sourceDeviceId: parsed.data.deviceId,
        sourceSessionId: session.sourceSessionId,
        appName: session.appName,
        windowTitle: session.windowTitle ?? null,
        browserUrl: session.browserUrl ?? null,
        browserPageTitle: session.browserPageTitle ?? null,
        visibleApps: visibleAppsJson,
        tags: tagsJson,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSecs,
        ingestionStatus: "pending",
        ingestedAt: now,
      });
    }

    accepted.push(session.sourceSessionId);
  }

  return Response.json({
    acceptedCount: accepted.length,
    accepted,
    rejected,
    timeZone: parsed.data.timeZone,
  });
}
