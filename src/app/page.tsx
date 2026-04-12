import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { LandingPage } from "@/components/marketing/landing-page";

export default async function RootPage() {
  const session = await getRequestSession();
  if (session) {
    redirect("/dashboard");
  }
  return <LandingPage />;
}
