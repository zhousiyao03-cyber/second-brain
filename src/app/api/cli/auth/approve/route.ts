import { z } from "zod/v4";
import { auth } from "@/lib/auth";
import { generateCliToken } from "@/server/ai/cli-auth";
import { approveCliAuthSession } from "@/server/ai/cli-auth-session";

const bodySchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const { token } = await generateCliToken(session.user.id, "CLI (browser auth)");
  const ok = approveCliAuthSession(parsed.data.sessionId, token);

  if (!ok) {
    return Response.json({ error: "Session expired or already used" }, { status: 410 });
  }

  return Response.json({ ok: true });
}
