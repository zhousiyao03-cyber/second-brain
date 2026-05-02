import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/public-origin";
import { getEntitlements } from "@/server/billing/entitlements";
import { callKnosiMcpTool, KNOSI_MCP_TOOLS } from "@/server/integrations/mcp-tools";
import { OAUTH_SCOPES } from "@/server/integrations/oauth-clients";
import { OAuthError, validateBearerAccessToken } from "@/server/integrations/oauth";

function withMcpHeaders(response: NextResponse, sessionId?: string) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (sessionId) {
    response.headers.set("Mcp-Session-Id", sessionId);
  }
  return response;
}

function jsonRpcResult(id: unknown, result: unknown, sessionId?: string) {
  return withMcpHeaders(NextResponse.json({ jsonrpc: "2.0", id, result }), sessionId);
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return withMcpHeaders(
    NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 400 })
  );
}

const OAUTH_CHALLENGE_CODES = new Set([
  "missing_bearer_token",
  "access_token_not_found",
  "access_token_expired",
  "access_token_revoked",
  "insufficient_scope",
]);

function jsonRpcAuthError(
  request: NextRequest,
  id: unknown,
  oauthError: OAuthError,
  requiredScopes: readonly string[]
) {
  const origin = getPublicOrigin(request);
  const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  const challengeParts: string[] = [`resource_metadata="${resourceMetadataUrl}"`];
  if (oauthError.code === "insufficient_scope") {
    challengeParts.push(`error="insufficient_scope"`, `scope="${requiredScopes.join(" ")}"`);
  } else {
    challengeParts.push(`error="invalid_token"`);
  }
  challengeParts.push(`error_description="${oauthError.message.replace(/"/g, '\\"')}"`);

  const response = NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: { code: -32001, message: oauthError.message, data: { oauth_code: oauthError.code } },
    },
    { status: 401 }
  );
  response.headers.set("WWW-Authenticate", `Bearer ${challengeParts.join(", ")}`);
  return withMcpHeaders(response);
}

export function GET() {
  const encoder = new TextEncoder();
  const sessionId = randomUUID();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      interval = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
    },
  });

  return withMcpHeaders(
    new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "Cache-Control": "no-store",
      },
    }),
    sessionId
  );
}

export function OPTIONS() {
  return withMcpHeaders(
    new NextResponse(null, {
      status: 204,
      headers: {
        Allow: "GET, POST, OPTIONS",
      },
    })
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        jsonrpc?: string;
        id?: unknown;
        method?: string;
        params?: Record<string, unknown>;
      }
    | null;

  if (!body?.method) {
    return jsonRpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request");
  }

  if (body.method === "initialize") {
    const sessionId = request.headers.get("mcp-session-id") ?? randomUUID();
    const clientProtocol =
      typeof body.params?.protocolVersion === "string"
        ? body.params.protocolVersion
        : "2025-06-18";
    const SUPPORTED = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
    const protocolVersion = SUPPORTED.has(clientProtocol)
      ? clientProtocol
      : "2025-06-18";
    return jsonRpcResult(body.id ?? null, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "knosi-mcp", version: "0.1.0" },
    }, sessionId);
  }

  if (
    body.method === "notifications/initialized" ||
    body.method === "initialized"
  ) {
    return withMcpHeaders(new NextResponse(null, { status: 202 }));
  }

  if (body.method === "ping") {
    return jsonRpcResult(body.id ?? null, {});
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(body.id ?? null, { tools: KNOSI_MCP_TOOLS });
  }

  if (body.method !== "tools/call") {
    return jsonRpcError(body.id ?? null, -32601, `Unsupported method: ${body.method}`);
  }

  const toolName = String(body.params?.name ?? "");
  const toolArgs =
    body.params?.arguments && typeof body.params.arguments === "object"
      ? (body.params.arguments as Record<string, unknown>)
      : {};

  const requiredScopes = (() => {
    switch (toolName) {
      case "save_to_knosi":
      case "create_note":
      case "create_learning_card":
        return [OAUTH_SCOPES.knowledgeWriteInbox];
      case "knosi_pref_list":
        return [OAUTH_SCOPES.preferencesRead];
      case "knosi_pref_set":
      case "knosi_pref_delete":
        return [OAUTH_SCOPES.preferencesWrite];
      default:
        return [OAUTH_SCOPES.knowledgeRead];
    }
  })();

  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
      requiredScopes,
    });

    if (toolName === "save_to_knosi") {
      const ent = await getEntitlements(auth.userId);
      if (!ent.features.claudeCapture) {
        return jsonRpcError(
          body.id ?? null,
          -32000,
          "PRO_REQUIRED: Claude Capture requires a Pro plan."
        );
      }
    }

    const structured = await callKnosiMcpTool({
      userId: auth.userId,
      name: toolName as never,
      arguments: toolArgs,
    });

    return jsonRpcResult(body.id ?? null, {
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    });
  } catch (error) {
    if (error instanceof OAuthError && OAUTH_CHALLENGE_CODES.has(error.code)) {
      return jsonRpcAuthError(request, body.id ?? null, error, requiredScopes);
    }
    const message = error instanceof Error ? error.message : "MCP tool call failed";
    return jsonRpcError(body.id ?? null, -32000, message);
  }
}
