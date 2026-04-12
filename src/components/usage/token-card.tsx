export function TokenCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="text-[11px] text-stone-400 dark:text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">{value}</div>
    </div>
  );
}
