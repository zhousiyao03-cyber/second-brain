export default function BookmarksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-stone-200/60 bg-white/60 p-4 dark:border-stone-800/60 dark:bg-stone-950/40"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-stone-200/60 dark:bg-stone-800/60" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/60" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100/60 dark:bg-stone-800/40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
