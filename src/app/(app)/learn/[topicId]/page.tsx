import { redirect } from "next/navigation";
import { LearnTopicClient } from "@/components/learn/learn-topic-client";
import { getRequestSession } from "@/server/auth/request-session";

export default async function LearnTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { topicId } = await params;
  return <LearnTopicClient topicId={topicId} />;
}
