import { NextRequest, NextResponse } from "next/server";
import { captureAiNote } from "@/server/integrations/ai-capture";
import { validateBearerAccessToken } from "@/server/integrations/oauth";
import { OAUTH_SCOPES } from "@/server/integrations/oauth-clients";

export async function POST(request: NextRequest) {
  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
      requiredScopes: [OAUTH_SCOPES.knowledgeWriteInbox],
    });

    const body = (await request.json().catch(() => null)) as
      | {
          title?: string;
          sourceApp?: string;
          capturedAtLabel?: string;
          sourceMeta?: Record<string, unknown>;
          messages?: Array<{ role?: string; content?: string }>;
        }
      | null;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "messages are required" },
        { status: 400 }
      );
    }

    const result = await captureAiNote({
      userId: auth.userId,
      title: body.title,
      sourceApp: body.sourceApp ?? "claude-code",
      capturedAtLabel: body.capturedAtLabel ?? new Date().toISOString(),
      sourceMeta: body.sourceMeta,
      messages: body.messages.map((message) => ({
        role: typeof message.role === "string" ? message.role : "user",
        content: typeof message.content === "string" ? message.content : "",
      })),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture failed.";
    return NextResponse.json(
      { error: "capture_failed", error_description: message },
      { status: 400 }
    );
  }
}
