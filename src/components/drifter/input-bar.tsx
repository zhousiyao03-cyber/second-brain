"use client";

import { useEffect, useRef, useState } from "react";
import { t, type DrifterLang } from "@/lib/drifter/i18n";

type InputBarProps = {
  lang: DrifterLang;
  hooks: string[] | null;
  disabled: boolean;
  onSend: (text: string) => void;
};

export function InputBar({ lang, hooks, disabled, onSend }: InputBarProps) {
  const tx = t(lang);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [disabled]);

  const submit = (override?: string) => {
    const text = (override ?? value).trim();
    if (!text || disabled) return;
    onSend(text);
    if (override === undefined) {
      setValue("");
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-stretch gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          maxLength={2000}
          disabled={disabled}
          placeholder={tx.placeholder}
          aria-label={tx.placeholder}
          className="flex-1 rounded-lg border border-amber-200/20 bg-black/50 px-4 py-3 text-amber-50 placeholder-amber-100/30 outline-none backdrop-blur-md transition focus:border-amber-200/50 disabled:opacity-60"
          data-testid="drifter-input"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className="rounded-lg border border-amber-200/30 bg-amber-200/10 px-5 text-sm tracking-wider text-amber-100 transition hover:bg-amber-200/20 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="drifter-send"
        >
          {tx.send}
        </button>
      </form>

      {hooks && hooks.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="drifter-hooks">
          <span className="text-[11px] tracking-wider text-amber-100/40">
            {tx.hookHint}
          </span>
          {hooks.map((hook, i) => (
            <button
              key={`${i}-${hook}`}
              type="button"
              onClick={() => submit(hook)}
              disabled={disabled}
              className="rounded-full border border-amber-200/20 bg-black/30 px-3 py-1 text-xs text-amber-100/70 transition hover:border-amber-200/50 hover:text-amber-100 disabled:opacity-40"
              data-testid={`drifter-hook-${i}`}
            >
              {hook}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
