import { notFound, redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { getOpsOwnerAccess } from "@/server/ops/authorization";
import { getOpsPageData } from "@/server/ops/page-data";
import { OpsDashboard } from "./ops-dashboard";

export default async function SettingsOpsPage() {
  const session = await getRequestSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const access = getOpsOwnerAccess(session);
  if (!access.allowed && access.reason !== "missing-owner-config") {
    notFound();
  }

  if (!access.allowed && access.reason === "missing-owner-config") {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Ops</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            Add <code>OPS_OWNER_EMAIL</code> to enable the owner-only Ops dashboard.
          </p>
        </div>
      </div>
    );
  }

  const data = await getOpsPageData();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Ops</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Deployment, daemon, queue, cron, and machine health for this self-hosted stack.
        </p>
      </div>
      <OpsDashboard data={data} />
    </div>
  );
}
