import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { oauthClients } from "@/server/db/schema";
import {
  OAUTH_SCOPES,
  normalizeOAuthScopes,
} from "@/server/integrations/oauth-clients";

const ALL_SCOPES = [OAUTH_SCOPES.knowledgeRead, OAUTH_SCOPES.knowledgeWriteInbox];

function errorResponse(code: string, description: string, status = 400) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status }
  );
}

function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || !uri.trim()) return false;
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") {
      return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    }
    if (url.protocol === "claude:") return true;
    return false;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("invalid_request", "Request body must be JSON.");
  }

  const redirectUrisRaw = body.redirect_uris;
  if (!Array.isArray(redirectUrisRaw) || redirectUrisRaw.length === 0) {
    return errorResponse(
      "invalid_redirect_uri",
      "redirect_uris must be a non-empty array."
    );
  }
  if (!redirectUrisRaw.every(isValidRedirectUri)) {
    return errorResponse(
      "invalid_redirect_uri",
      "Every redirect_uri must be https, http(localhost), or claude:// ."
    );
  }
  const redirectUris = redirectUrisRaw as string[];

  const tokenEndpointAuthMethod =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";
  if (tokenEndpointAuthMethod !== "none") {
    return errorResponse(
      "invalid_client_metadata",
      "Only token_endpoint_auth_method=none is supported (public clients with PKCE)."
    );
  }

  const grantTypesRaw = Array.isArray(body.grant_types)
    ? (body.grant_types as string[])
    : ["authorization_code", "refresh_token"];
  for (const gt of grantTypesRaw) {
    if (gt !== "authorization_code" && gt !== "refresh_token") {
      return errorResponse(
        "invalid_client_metadata",
        `Unsupported grant_type: ${gt}`
      );
    }
  }

  let allowedScopes: string[];
  try {
    const scopeString =
      typeof body.scope === "string" && body.scope.trim().length > 0
        ? body.scope
        : ALL_SCOPES.join(" ");
    allowedScopes = normalizeOAuthScopes(scopeString);
  } catch (error) {
    return errorResponse(
      "invalid_scope",
      error instanceof Error ? error.message : "Invalid scope."
    );
  }

  const clientName =
    (typeof body.client_name === "string" && body.client_name.trim()) ||
    "Registered MCP Client";
  const clientUri =
    typeof body.client_uri === "string" && body.client_uri.trim()
      ? body.client_uri
      : null;
  const logoUri =
    typeof body.logo_uri === "string" && body.logo_uri.trim()
      ? body.logo_uri
      : null;

  const clientId = `dyn_${crypto.randomBytes(16).toString("hex")}`;
  const issuedAt = Math.floor(Date.now() / 1000);

  await db.insert(oauthClients).values({
    clientId,
    clientName,
    redirectUris: JSON.stringify(redirectUris),
    allowedScopes: allowedScopes.join(" "),
    tokenEndpointAuthMethod: "none",
    grantTypes: grantTypesRaw.join(" "),
    clientUri,
    logoUri,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypesRaw,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: allowedScopes.join(" "),
      ...(clientUri ? { client_uri: clientUri } : {}),
      ...(logoUri ? { logo_uri: logoUri } : {}),
    },
    { status: 201 }
  );
}
