import { redirect } from "next/navigation";
import { LearnNoteClient } from "@/components/learn/learn-note-client";
import { getRequestSession } from "@/server/auth/request-session";

export default async function LearnNotePage({
  params,
}: {
  params: Promise<{ topicId: string; noteId: string }>;
}) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { topicId, noteId } = await params;
  return <LearnNoteClient topicId={topicId} noteId={noteId} />;
}
