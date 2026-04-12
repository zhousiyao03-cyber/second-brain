import { NextRequest, NextResponse } from "next/server";
import {
  revokeOAuthAccessToken,
  revokeOAuthRefreshToken,
} from "@/server/integrations/oauth";

async function readRevokeRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    return new Map(Object.entries(body ?? {}));
  }

  const form = await request.formData();
  return form;
}

export async function POST(request: NextRequest) {
  const body = await readRevokeRequest(request);
  const token = String(body.get("token") ?? "");

  if (!token) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "token is required" },
      { status: 400 }
    );
  }

  const revokedAccess = await revokeOAuthAccessToken({ accessToken: token });
  const revokedRefresh = revokedAccess
    ? false
    : await revokeOAuthRefreshToken({ refreshToken: token });

  return NextResponse.json({ revoked: revokedAccess || revokedRefresh });
}
