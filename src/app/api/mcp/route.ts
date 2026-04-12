import { NextRequest, NextResponse } from "next/server";
import { callKnosiMcpTool, KNOSI_MCP_TOOLS } from "@/server/integrations/mcp-tools";
import { OAUTH_SCOPES } from "@/server/integrations/oauth-clients";
import { validateBearerAccessToken } from "@/server/integrations/oauth";

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 400 });
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
    return jsonRpcResult(body.id ?? null, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "knosi-mcp", version: "0.1.0" },
    });
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

  try {
    const requiredScopes =
      toolName === "save_to_knosi"
        ? [OAUTH_SCOPES.knowledgeWriteInbox]
        : [OAUTH_SCOPES.knowledgeRead];
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
      requiredScopes,
    });

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
    const message = error instanceof Error ? error.message : "MCP tool call failed";
    return jsonRpcError(body.id ?? null, -32000, message);
  }
}
