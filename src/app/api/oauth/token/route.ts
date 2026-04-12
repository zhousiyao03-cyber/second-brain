import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  OAuthError,
} from "@/server/integrations/oauth";
import { normalizeOAuthScopes } from "@/server/integrations/oauth-clients";

async function readTokenRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    return new Map(Object.entries(body ?? {}));
  }

  const form = await request.formData();
  return form;
}

function oauthErrorResponse(error: unknown) {
  if (error instanceof OAuthError) {
    return NextResponse.json(
      { error: error.code, error_description: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: "server_error", error_description: "OAuth token exchange failed." },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await readTokenRequest(request);
    const grantType = String(body.get("grant_type") ?? "");
    const clientId = String(body.get("client_id") ?? "");

    if (grantType === "authorization_code") {
      const result = await exchangeAuthorizationCode({
        authorizationCode: String(body.get("code") ?? ""),
        clientId,
        redirectUri: String(body.get("redirect_uri") ?? ""),
        codeVerifier: String(body.get("code_verifier") ?? ""),
      });

      return NextResponse.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        expires_in: 60 * 60,
        scope: result.accessTokenRecord.scopes,
      });
    }

    if (grantType === "refresh_token") {
      const scopeValue = String(body.get("scope") ?? "");
      const result = await refreshAccessToken({
        refreshToken: String(body.get("refresh_token") ?? ""),
        clientId,
        scopes: scopeValue ? normalizeOAuthScopes(scopeValue) : undefined,
      });

      return NextResponse.json({
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: 60 * 60,
        scope: result.accessTokenRecord.scopes,
      });
    }

    return NextResponse.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code and refresh_token are supported.",
      },
      { status: 400 }
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
