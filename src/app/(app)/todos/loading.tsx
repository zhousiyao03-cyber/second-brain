export default function TodosLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-stone-200/60 bg-white/60 p-3 dark:border-stone-800/60 dark:bg-stone-950/40"
          >
            <div className="h-5 w-5 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
            <div className="h-4 flex-1 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/60" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
