import { NextRequest, NextResponse } from "next/server";
import { OAUTH_SCOPES } from "@/server/integrations/oauth-clients";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPES.knowledgeRead, OAUTH_SCOPES.knowledgeWriteInbox],
  });
}
