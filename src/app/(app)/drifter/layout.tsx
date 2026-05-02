import { getRequestSession } from "@/server/auth/request-session";
import { redirect } from "next/navigation";

export default async function DrifterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRequestSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0608] text-amber-50">
      {children}
    </div>
  );
}
