import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/public-origin";
import { OAUTH_SCOPES } from "@/server/integrations/oauth-clients";

export function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);

  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPES.knowledgeRead, OAUTH_SCOPES.knowledgeWriteInbox],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/docs`,
  });
}
