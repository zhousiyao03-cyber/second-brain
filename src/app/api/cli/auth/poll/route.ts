import { getCliAuthSessionStatus } from "@/server/ai/cli-auth-session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return Response.json({ error: "Missing session_id" }, { status: 400 });
  }

  const status = getCliAuthSessionStatus(sessionId);

  if (status === null) {
    return Response.json({ status: "expired" });
  }
  if (status === "pending") {
    return Response.json({ status: "pending" });
  }
  return Response.json({ status: "approved", token: status });
}
