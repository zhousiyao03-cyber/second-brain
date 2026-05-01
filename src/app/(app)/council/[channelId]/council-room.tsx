"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import {
  useCouncilStream,
  type ClientMessage,
} from "./use-council-stream";
import type { Persona } from "@/server/council/types";
import { cn } from "@/lib/utils";

type Props = {
  channelId: string;
  channelName: string;
  channelTopic: string | null;
  personas: Persona[];
  initialMessages: ClientMessage[];
};

const PERSONA_COLORS = [
  "bg-sky-100 dark:bg-sky-950 border-sky-300 dark:border-sky-800",
  "bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800",
  "bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-800",
  "bg-violet-100 dark:bg-violet-950 border-violet-300 dark:border-violet-800",
];

function colorForPersona(personas: Persona[], id: string): string {
  const idx = personas.findIndex((p) => p.id === id);
  return PERSONA_COLORS[idx % PERSONA_COLORS.length];
}

export function CouncilRoom({
  channelId,
  channelName,
  channelTopic,
  personas,
  initialMessages,
}: Props) {
  const { messages, isStreaming, send, stop } = useCouncilStream(
    channelId,
    initialMessages,
  );
  const [input, setInput] = useState("");
  const personaById = new Map(personas.map((p) => [p.id, p]));
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    void send(text);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-stone-200 px-6 py-3 dark:border-stone-800">
        <h1 className="text-lg font-semibold">#{channelName}</h1>
        {channelTopic && (
          <p className="text-sm text-stone-500">{channelTopic}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {personas.map((p) => (
            <span
              key={p.id}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                colorForPersona(personas, p.id),
              )}
            >
              {p.avatarEmoji} {p.name}
            </span>
          ))}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.length === 0 && (
            <p className="self-center text-sm text-stone-500">
              Throw a question to start the discussion.
            </p>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              persona={msg.personaId ? personaById.get(msg.personaId) : undefined}
              colorClass={
                msg.personaId ? colorForPersona(personas, msg.personaId) : ""
              }
            />
          ))}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-stone-200 bg-stone-50 px-6 py-3 dark:border-stone-800 dark:bg-stone-950"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            placeholder="Throw a question…"
            rows={1}
            className="flex-1 resize-none rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900"
          />
          {isStreaming && (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              aria-label="Stop discussion"
            >
              <Square className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  msg,
  persona,
  colorClass,
}: {
  msg: ClientMessage;
  persona?: Persona;
  colorClass: string;
}) {
  if (msg.role === "system") {
    return (
      <div className="my-2 self-center text-center text-xs text-stone-500">
        ── {msg.content} ──
      </div>
    );
  }
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[80%] rounded-lg bg-sky-600 px-3 py-2 text-sm text-white whitespace-pre-wrap">
        {msg.content}
      </div>
    );
  }
  // agent
  return (
    <div className="self-start max-w-[80%]">
      <div className="mb-1 text-xs text-stone-500">
        {persona?.avatarEmoji} {persona?.name ?? "Agent"}
      </div>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap",
          colorClass,
          msg.status === "interrupted" && "opacity-70",
        )}
      >
        {msg.content}
        {msg.status === "streaming" && (
          <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-stone-500 align-middle" />
        )}
        {msg.status === "interrupted" && (
          <span className="ml-2 text-xs italic text-stone-500">
            (interrupted)
          </span>
        )}
      </div>
    </div>
  );
}
