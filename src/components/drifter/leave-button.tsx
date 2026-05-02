"use client";

import { t, type DrifterLang } from "@/lib/drifter/i18n";

export function LeaveButton({
  lang,
  onLeave,
}: {
  lang: DrifterLang;
  onLeave: () => void;
}) {
  const tx = t(lang);
  return (
    <button
      type="button"
      onClick={onLeave}
      className="absolute top-4 right-4 z-20 rounded border border-amber-200/20 bg-black/40 px-3 py-1.5 text-[11px] tracking-wider text-amber-100/70 backdrop-blur-sm transition hover:border-amber-200/50 hover:text-amber-100"
      data-testid="drifter-leave"
    >
      {tx.stepOutside}
    </button>
  );
}
