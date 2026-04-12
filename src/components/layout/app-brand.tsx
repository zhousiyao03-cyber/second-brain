import Image from "next/image";
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
      <Image
        src="/knosi-logo.png"
        alt="Knosi"
        width={36}
        height={36}
        className="shrink-0 rounded-xl"
        unoptimized
      />

      {compact ? null : (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-stone-900 dark:text-stone-100">
            Knosi
          </div>
        </div>
      )}
    </div>
  );
}
