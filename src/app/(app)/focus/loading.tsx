export default function FocusLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-stone-200/60 bg-white/60 p-5 dark:border-stone-800/60 dark:bg-stone-950/40"
          >
            <div className="space-y-3">
              <div className="h-3 w-20 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/60" />
              <div className="h-8 w-24 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/60" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-2xl border border-stone-200/60 bg-white/60 dark:border-stone-800/60 dark:bg-stone-950/40" />
    </div>
  );
}
