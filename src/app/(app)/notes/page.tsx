import { redirect } from "next/navigation";
import { NotesPageClient } from "@/components/notes/notes-page-client";
import { getRequestSession } from "@/server/auth/request-session";

export default async function NotesPage() {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <NotesPageClient />;
}
