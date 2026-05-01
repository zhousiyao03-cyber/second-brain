import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureDefaultCouncilChannel } from "@/server/council/seeds";

export default async function CouncilIndexPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { channelId } = await ensureDefaultCouncilChannel(session.user.id);
  redirect(`/council/${channelId}`);
}
