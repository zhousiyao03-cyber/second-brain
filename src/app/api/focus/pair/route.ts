import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { focusDevicePairings, focusDevices } from "@/server/db/schema";
import {
  createFocusDeviceToken,
  getFocusDeviceTokenPreview,
  hashFocusDeviceToken,
} from "@/server/focus/device-auth";
import {
  hashFocusPairingCode,
  isFocusPairingExpired,
} from "@/server/focus/pairing";
import { enforceFocusRateLimit } from "@/server/focus/rate-limit";

const pairBodySchema = z.object({
  code: z.string().trim().min(6).max(32),
  deviceId: z.string().trim().min(1),
  deviceName: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = pairBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid input",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown";
  const clientIp = forwardedFor.split(",")[0]?.trim() || "unknown";
  const rateLimit = await enforceFocusRateLimit({
    scope: "pairing:complete",
    key: `${clientIp}:${parsed.data.deviceId}`,
    maxAttempts: 8,
    windowSecs: 15 * 60,
  });
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Too Many Requests",
        retryAfterSecs: rateLimit.retryAfterSecs,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(rateLimit.retryAfterSecs),
        },
      }
    );
  }

  const now = new Date();
  const codeHash = hashFocusPairingCode(parsed.data.code);
  const token = createFocusDeviceToken();
  const tokenHash = hashFocusDeviceToken(token);
  const tokenPreview = getFocusDeviceTokenPreview(token);

  const result = await db.transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(focusDevicePairings)
      .where(
        and(
          eq(focusDevicePairings.codeHash, codeHash),
          isNull(focusDevicePairings.consumedAt)
        )
      )
      .limit(1);

    if (!pairing) {
      return { error: "invalid" as const };
    }

    if (isFocusPairingExpired(pairing.expiresAt, now)) {
      await tx
        .update(focusDevicePairings)
        .set({
          consumedAt: now,
          updatedAt: now,
        })
        .where(eq(focusDevicePairings.id, pairing.id));
      return { error: "expired" as const };
    }

    const [existingDevice] = await tx
      .select({ id: focusDevices.id })
      .from(focusDevices)
      .where(
        and(
          eq(focusDevices.userId, pairing.userId),
          eq(focusDevices.deviceId, parsed.data.deviceId)
        )
      )
      .limit(1);

    const devicePayload = {
      name: parsed.data.deviceName,
      tokenHash,
      tokenPreview,
      revokedAt: null,
      updatedAt: now,
    };

    if (existingDevice) {
      await tx
        .update(focusDevices)
        .set(devicePayload)
        .where(eq(focusDevices.id, existingDevice.id));
    } else {
      await tx.insert(focusDevices).values({
        userId: pairing.userId,
        deviceId: parsed.data.deviceId,
        name: parsed.data.deviceName,
        tokenHash,
        tokenPreview,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx
      .update(focusDevicePairings)
      .set({
        consumedAt: now,
        pairedDeviceId: parsed.data.deviceId,
        pairedDeviceName: parsed.data.deviceName,
        updatedAt: now,
      })
      .where(eq(focusDevicePairings.id, pairing.id));

    return {
      deviceId: parsed.data.deviceId,
      deviceName: parsed.data.deviceName,
      token,
      tokenPreview,
      expiresAt: pairing.expiresAt.toISOString(),
    };
  });

  if ("error" in result) {
    const status = result.error === "expired" ? 410 : 404;
    const message =
      result.error === "expired" ? "Pairing code expired" : "Pairing code not found";
    return Response.json({ error: message }, { status });
  }

  return Response.json(result);
}
