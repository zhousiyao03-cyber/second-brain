import { Suspense } from "react";
import { cookies } from "next/headers";
import { FloatingAskAiDock } from "@/components/ask/floating-ask-ai-dock";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceIdentityProvider } from "@/components/layout/workspace-identity-provider";
import { getWorkspaceLabel } from "@/components/layout/workspace-label";
import { SearchDialog } from "@/components/search-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { getRequestSession } from "@/server/auth/request-session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRequestSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  const workspaceLabel = getWorkspaceLabel(
    session?.user?.name,
    session?.user?.email
  );
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get("sb_collapsed")?.value === "1";

  return (
    <ToastProvider>
      <WorkspaceIdentityProvider
        value={{ email: session?.user?.email, name: session?.user?.name }}
      >
        <div
          data-app-shell
          className="flex h-full bg-[var(--background)]"
          style={
            {
              "--app-sidebar-w": sidebarCollapsed ? "68px" : "15rem",
            } as React.CSSProperties
          }
        >
          <Sidebar
            workspaceLabel={workspaceLabel}
            initialCollapsed={sidebarCollapsed}
          />
          <div className="min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.88),rgba(251,251,250,1)_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(38,38,38,0.96),rgba(25,25,25,1)_36%)] dark:text-stone-100">
            <MobileNav workspaceLabel={workspaceLabel} />
            <main className="px-4 py-5 md:px-6 md:py-6">
              <Suspense>{children}</Suspense>
            </main>
          </div>
          <SearchDialog />
          <FloatingAskAiDock />
        </div>
      </WorkspaceIdentityProvider>
    </ToastProvider>
  );
}
