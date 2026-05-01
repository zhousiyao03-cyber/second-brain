import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { ensureDefaultCouncilChannel } from "@/server/council/seeds";

export default async function CouncilIndexPage() {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { channelId } = await ensureDefaultCouncilChannel(session.user.id);
  redirect(`/council/${channelId}`);
}
