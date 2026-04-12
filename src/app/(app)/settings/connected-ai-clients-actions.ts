"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import { oauthAccessTokens, oauthRefreshTokens } from "@/server/db/schema";

const revokeSchema = z.object({
  tokenId: z.string().trim().min(1),
  tokenType: z.enum(["access", "refresh"]),
});

async function requireSettingsUserId() {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
}

export async function revokeConnectedAiClient(formData: FormData) {
  const userId = await requireSettingsUserId();
  const parsed = revokeSchema.safeParse({
    tokenId: formData.get("tokenId"),
    tokenType: formData.get("tokenType"),
  });

  if (!parsed.success) {
    redirect("/settings?aiClientsStatus=invalid");
  }

  const revokedAt = new Date();

  if (parsed.data.tokenType === "refresh") {
    await db
      .update(oauthRefreshTokens)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(
        and(
          eq(oauthRefreshTokens.id, parsed.data.tokenId),
          eq(oauthRefreshTokens.userId, userId)
        )
      );

    await db
      .update(oauthAccessTokens)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(oauthAccessTokens.refreshTokenId, parsed.data.tokenId));
  } else {
    await db
      .update(oauthAccessTokens)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(
        and(
          eq(oauthAccessTokens.id, parsed.data.tokenId),
          eq(oauthAccessTokens.userId, userId)
        )
      );
  }

  redirect("/settings?aiClientsStatus=revoked");
}
