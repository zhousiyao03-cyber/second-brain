import type { ReactNode } from "react";

export function OpsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
