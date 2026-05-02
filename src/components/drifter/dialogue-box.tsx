"use client";

import { useEffect, useRef, useState } from "react";
import { t, type DrifterLang } from "@/lib/drifter/i18n";
import type { DrifterMessage } from "@/lib/drifter/types";

type DialogueBoxProps = {
  lang: DrifterLang;
  history: DrifterMessage[];
  /** Whether Pip is currently producing a reply (await network). */
  pipPending: boolean;
};

const TYPEWRITER_CPS = 35;

export function DialogueBox({ lang, history, pipPending }: DialogueBoxProps) {
  const tx = t(lang);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [revealedCounts, setRevealedCounts] = useState<Record<string, number>>(
    {}
  );

  // Typewriter — reveal Pip messages char-by-char on first arrival.
  useEffect(() => {
    const last = history[history.length - 1];
    if (!last) return;
    if (last.role !== "pip") return;

    const startedAt = revealedCounts[last.id];
    if (startedAt !== undefined && startedAt >= last.content.length) return;

    let i = startedAt ?? 0;
    const tick = () => {
      i = Math.min(i + 1, last.content.length);
      setRevealedCounts((prev) => ({ ...prev, [last.id]: i }));
      if (i < last.content.length) {
        timer = window.setTimeout(tick, 1000 / TYPEWRITER_CPS);
      }
    };
    let timer = window.setTimeout(tick, 1000 / TYPEWRITER_CPS);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [history, revealedCounts]);

  return (
    <div
      ref={containerRef}
      className="max-h-[34vh] overflow-y-auto rounded-lg border border-amber-200/20 bg-black/55 px-5 py-4 text-[15px] leading-relaxed text-amber-50/90 backdrop-blur-md"
      data-testid="drifter-dialogue"
    >
      {history.length === 0 && !pipPending && (
        <p className="text-amber-100/40 italic">…</p>
      )}
      <ol className="space-y-3">
        {history.map((msg) => {
          const revealed =
            msg.role === "pip"
              ? msg.content.slice(0, revealedCounts[msg.id] ?? msg.content.length)
              : msg.content;
          return (
            <li key={msg.id} data-role={msg.role}>
              <span
                className={
                  msg.role === "pip"
                    ? "text-amber-200/70 mr-2 text-[11px] tracking-widest uppercase"
                    : "text-amber-100/40 mr-2 text-[11px] tracking-widest uppercase"
                }
              >
                {msg.role === "pip" ? tx.pipName : tx.visitorYou}
              </span>
              <span
                className={msg.role === "pip" ? "text-amber-50/95" : "text-amber-50/70"}
              >
                {revealed}
                {msg.role === "pip" &&
                  (revealedCounts[msg.id] ?? msg.content.length) <
                    msg.content.length && (
                    <span className="ml-0.5 inline-block h-3 w-[2px] -mb-0.5 animate-pulse bg-amber-200/80" />
                  )}
              </span>
            </li>
          );
        })}
        {pipPending && (
          <li className="text-amber-200/40 text-sm italic" data-testid="drifter-typing">
            {tx.pipName} {lang === "zh" ? "在想..." : "is thinking..."}
          </li>
        )}
      </ol>
    </div>
  );
}
