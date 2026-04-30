import { redirect } from "next/navigation";
import { LearnNewNoteClient } from "@/components/learn/learn-new-note-client";
import { getRequestSession } from "@/server/auth/request-session";

export default async function LearnNewNotePage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { topicId } = await params;
  return <LearnNewNoteClient topicId={topicId} />;
}
