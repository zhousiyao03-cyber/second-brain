import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppBrandProps {
  compact?: boolean;
  className?: string;
}

export function AppBrand({ compact = false, className }: AppBrandProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        compact && "justify-center",
        className
      )}
    >
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-linear-to-br from-stone-900 to-stone-700 text-white shadow-[0_6px_20px_-10px_rgba(15,23,42,0.5)] dark:from-stone-100 dark:to-stone-300 dark:text-stone-900">
        <div className="absolute inset-x-0 top-0 h-3 bg-linear-to-b from-cyan-300/40 to-transparent" />
        <div className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-cyan-300" />
        <BrainCircuit className="relative h-[18px] w-[18px]" strokeWidth={2} />
      </div>

      {compact ? null : (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-stone-900 dark:text-stone-100">
            Second Brain
          </div>
        </div>
      )}
    </div>
  );
}
