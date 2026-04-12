import { createCliAuthSession } from "@/server/ai/cli-auth-session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const serverUrl = body.serverUrl || "";

  const sessionId = createCliAuthSession();
  const authUrl = `${serverUrl}/cli/auth?session_id=${sessionId}`;

  return Response.json({ sessionId, authUrl });
}
