import { OpsCard } from "./ops-card";
import type { getOpsPageData } from "@/server/ops/page-data";

type OpsPageData = Awaited<ReturnType<typeof getOpsPageData>>;

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function StatusPill({ value }: { value: string }) {
  const color =
    value === "healthy"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : value === "degraded"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      {value}
    </span>
  );
}

export function OpsDashboard({ data }: { data: OpsPageData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <OpsCard title="Deployment" description="What version is live on the box?">
          <dl className="grid gap-3 text-sm text-stone-700 dark:text-stone-200">
            <div>
              <dt className="font-medium text-stone-500 dark:text-stone-400">Git SHA</dt>
              <dd className="font-mono text-xs">{data.deployment.gitSha ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt className="font-medium text-stone-500 dark:text-stone-400">Deployment ID</dt>
              <dd className="font-mono text-xs">{data.deployment.deploymentId ?? "Unavailable"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="font-medium text-stone-500 dark:text-stone-400">Source</dt>
              <dd>{data.deployment.source}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="font-medium text-stone-500 dark:text-stone-400">Deployed</dt>
              <dd>{formatDate(data.deployment.deployedAt)}</dd>
            </div>
          </dl>
        </OpsCard>

        <OpsCard title="Services" description="Core stack and daemon liveness">
          <ul className="space-y-3 text-sm text-stone-700 dark:text-stone-200">
            {data.services.map((service) => (
              <li key={service.name} className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium capitalize">{service.name}</p>
                  {service.detail ? (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {service.detail}
                    </p>
                  ) : null}
                </div>
                <StatusPill value={service.status} />
              </li>
            ))}
          </ul>
        </OpsCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <OpsCard title="Queue" description="Is Ask AI draining normally?">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-stone-500 dark:text-stone-400">Queued</p>
              <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {data.queue.queued}
              </p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-stone-400">Running</p>
              <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {data.queue.running}
              </p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-stone-400">Recent failures</p>
              <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {data.queue.failedRecent}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-400">
              Recent activity
            </p>
            <ul className="space-y-2 text-sm text-stone-700 dark:text-stone-200">
              {data.queue.recentTasks.length === 0 ? (
                <li className="text-stone-500 dark:text-stone-400">No recent tasks.</li>
              ) : (
                data.queue.recentTasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs">{task.id.slice(0, 8)}</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {task.taskType} · {formatDate(task.activityAt)}
                      </p>
                    </div>
                    <StatusPill value={task.status} />
                  </li>
                ))
              )}
            </ul>
          </div>
        </OpsCard>

        <OpsCard title="System" description="Host pressure from the Hetzner box">
          {data.host.available ? (
            <dl className="grid gap-3 text-sm text-stone-700 dark:text-stone-200">
              <div className="flex items-center justify-between">
                <dt className="font-medium text-stone-500 dark:text-stone-400">Memory</dt>
                <dd>
                  {formatBytes(data.host.snapshot.host.memory.usedBytes)} /{" "}
                  {formatBytes(data.host.snapshot.host.memory.totalBytes)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="font-medium text-stone-500 dark:text-stone-400">Disk</dt>
                <dd>
                  {formatBytes(data.host.snapshot.host.disk.usedBytes)} /{" "}
                  {formatBytes(data.host.snapshot.host.disk.totalBytes)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="font-medium text-stone-500 dark:text-stone-400">Load</dt>
                <dd>{data.host.snapshot.host.loadAverage.join(" / ")}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="font-medium text-stone-500 dark:text-stone-400">Uptime</dt>
                <dd>{Math.floor(data.host.snapshot.host.uptimeSeconds / 60)} min</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-300">{data.host.reason}</p>
          )}
        </OpsCard>
      </div>

      <OpsCard title="Health" description="Should I SSH right now?">
        <div className="space-y-4 text-sm text-stone-700 dark:text-stone-200">
          <div className="flex items-center justify-between">
            <span className="font-medium">Overall status</span>
            <StatusPill value={data.overallStatus} />
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <div>
              <p className="text-stone-500 dark:text-stone-400">Slow queries</p>
              <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">
                {data.metrics.operational.slowQueryCount}
              </p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-stone-400">App errors</p>
              <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">
                {data.metrics.operational.appErrorCount}
              </p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-stone-400">Snapshot generated</p>
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                {formatDate(data.generatedAt)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            {Object.values(data.cron).map((job) => (
              <div
                key={job.jobName}
                className="rounded-2xl border border-stone-200 px-4 py-3 dark:border-stone-800"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {job.jobName}
                  </p>
                  <StatusPill value={job.status} />
                </div>
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  Last success: {formatDate(job.lastSuccessAt)}
                </p>
                {job.message ? (
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{job.message}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </OpsCard>
    </div>
  );
}
