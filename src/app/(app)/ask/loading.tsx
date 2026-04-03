export default function AskLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="h-8 w-36 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
      <div className="h-32 animate-pulse rounded-2xl border border-stone-200/60 bg-white/60 dark:border-stone-800/60 dark:bg-stone-950/40" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-32 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
        ))}
      </div>
    </div>
  );
}
