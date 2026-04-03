export default function NoteEditorLoading() {
  return (
    <div className="-mx-4 -mt-5 w-auto pb-10 md:-mx-6 md:-mt-6">
      <div className="mx-auto mb-4 flex w-full max-w-[1360px] items-center justify-between gap-4 px-6 pt-5 md:px-10 md:pt-6">
        <div className="h-7 w-32 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
        <div className="h-7 w-20 animate-pulse rounded-full bg-stone-200/60 dark:bg-stone-800/60" />
      </div>
      <div className="mx-auto w-full max-w-[980px] px-6 md:px-10">
        <div className="mt-8 mb-6 px-1">
          <div className="h-14 w-2/3 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" />
        </div>
        <div className="space-y-4 px-1">
          <div className="h-4 w-full animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
          <div className="h-4 w-full animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
        </div>
      </div>
    </div>
  );
}
