import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { SearchDialog } from "@/components/search-dialog";
import { ToastProvider } from "@/components/ui/toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-full bg-[var(--background)]">
        <Sidebar />
        <div className="min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.88),rgba(251,251,250,1)_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(38,38,38,0.96),rgba(25,25,25,1)_36%)] dark:text-stone-100">
          <MobileNav />
          <main className="px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
        <SearchDialog />
      </div>
    </ToastProvider>
  );
}
