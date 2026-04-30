import { redirect } from "next/navigation";
import { LearnHomeClient } from "@/components/learn/learn-home-client";
import { getRequestSession } from "@/server/auth/request-session";

export default async function LearnPage() {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <LearnHomeClient />;
}
