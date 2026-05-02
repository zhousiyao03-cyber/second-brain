"use client";

import { t, type DrifterLang } from "@/lib/drifter/i18n";
import type { DrifterTimeOfDay, DrifterWeather } from "@/lib/drifter/types";

type HudProps = {
  lang: DrifterLang;
  dayNumber: number;
  weather: DrifterWeather;
  timeOfDay: DrifterTimeOfDay;
};

export function DrifterHud({ lang, dayNumber, weather, timeOfDay }: HudProps) {
  const tx = t(lang);
  const dayLabel =
    lang === "zh" ? `第 ${dayNumber} 夜` : `${tx.hud.day} ${dayNumber}`;

  return (
    <div
      className="pointer-events-none absolute top-4 left-4 z-20 flex items-center gap-3 text-[10px] tracking-[0.18em] text-amber-100/55 font-mono uppercase"
      data-testid="drifter-hud"
    >
      <span>{dayLabel}</span>
      <span className="text-amber-100/30">·</span>
      <span>{tx.hud.time[timeOfDay]}</span>
      <span className="text-amber-100/30">·</span>
      <span>{tx.hud.weather[weather]}</span>
    </div>
  );
}
