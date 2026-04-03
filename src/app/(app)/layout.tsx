import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceIdentityProvider } from "@/components/layout/workspace-identity-provider";
import { getWorkspaceLabel } from "@/components/layout/workspace-label";
import { SearchDialog } from "@/components/search-dialog";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const workspaceLabel = getWorkspaceLabel(
    session?.user?.name,
    session?.user?.email
  );

  return (
    <ToastProvider>
      <WorkspaceIdentityProvider
        value={{ email: session?.user?.email, name: session?.user?.name }}
      >
        <div className="flex h-full bg-[var(--background)]">
          <Sidebar workspaceLabel={workspaceLabel} />
          <div className="min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.88),rgba(251,251,250,1)_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(38,38,38,0.96),rgba(25,25,25,1)_36%)] dark:text-stone-100">
            <MobileNav workspaceLabel={workspaceLabel} />
            <main className="px-4 py-5 md:px-6 md:py-6">
              <Suspense>{children}</Suspense>
            </main>
          </div>
          <SearchDialog />
        </div>
      </WorkspaceIdentityProvider>
    </ToastProvider>
  );
}
