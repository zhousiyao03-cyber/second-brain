export default function ProjectsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-stone-200/60 bg-white/60 p-5 dark:border-stone-800/60 dark:bg-stone-950/40"
          >
            <div className="space-y-3">
              <div className="h-5 w-2/3 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/60" />
              <div className="h-3 w-full animate-pulse rounded bg-stone-100/60 dark:bg-stone-800/40" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-stone-100/60 dark:bg-stone-800/40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
