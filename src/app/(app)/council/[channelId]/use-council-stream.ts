"use client";
import { useCallback, useRef, useState } from "react";
import type { SSEEvent } from "@/server/council/types";

export type ClientMessage = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  status: "streaming" | "complete" | "interrupted" | "error";
  personaId?: string;
  turnId?: string;
};

export type UseCouncilStream = {
  messages: ClientMessage[];
  isStreaming: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
};

export function useCouncilStream(
  channelId: string,
  initial: ClientMessage[],
): UseCouncilStream {
  const [messages, setMessages] = useState<ClientMessage[]>(initial);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<Promise<void> | null>(null);

  const doStream = useCallback(
    async (ctrl: AbortController, text: string) => {
      setIsStreaming(true);
      const userMsgId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        {
          id: userMsgId,
          role: "user",
          content: text,
          status: "complete",
        },
      ]);

      try {
        const res = await fetch(`/api/council/${channelId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, messageId: userMsgId }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const err = await res.text().catch(() => res.statusText);
          throw new Error(err || `HTTP ${res.status}`);
        }
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!raw.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(raw.slice(6)) as SSEEvent;
              applyEvent(evt, setMessages);
            } catch {
              // ignore malformed line
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || ctrl.signal.aborted) {
          // Client-side abort: mark any streaming messages as interrupted and
          // inject a user_interrupt system message so the UI reflects it.
          setMessages((m) => {
            const hasStreaming = m.some((msg) => msg.status === "streaming");
            const updated = m.map((msg) =>
              msg.status === "streaming"
                ? { ...msg, status: "interrupted" as const }
                : msg,
            );
            if (hasStreaming) {
              return [
                ...updated,
                {
                  id: crypto.randomUUID(),
                  role: "system" as const,
                  content: stoppedReasonToText("user_interrupt"),
                  status: "complete" as const,
                },
              ];
            }
            return updated;
          });
        } else {
          console.warn("[council] stream error", err);
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [channelId],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      // Barrier: abort any in-flight stream and wait for its finally
      // before starting a new one. Prevents two streams racing on the DB.
      if (abortRef.current) {
        abortRef.current.abort();
        if (flushRef.current) {
          await flushRef.current.catch(() => {
            /* swallow — abort is expected here */
          });
        }
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      flushRef.current = doStream(ctrl, text);
      await flushRef.current;
    },
    [doStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, send, stop };
}

function applyEvent(
  evt: SSEEvent,
  setMessages: React.Dispatch<React.SetStateAction<ClientMessage[]>>,
) {
  switch (evt.type) {
    case "turn_start":
      // informational only
      break;
    case "agent_start":
      setMessages((m) => [
        ...m,
        {
          id: evt.messageId,
          role: "agent",
          personaId: evt.personaId,
          turnId: evt.turnId,
          content: "",
          status: "streaming",
        },
      ]);
      break;
    case "agent_delta":
      setMessages((m) =>
        m.map((msg) =>
          msg.id === evt.messageId
            ? { ...msg, content: msg.content + evt.delta }
            : msg,
        ),
      );
      break;
    case "agent_end":
      setMessages((m) =>
        m.map((msg) =>
          msg.id === evt.messageId ? { ...msg, status: evt.status } : msg,
        ),
      );
      break;
    case "stopped":
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: stoppedReasonToText(evt.reason),
          status: "complete",
        },
      ]);
      break;
    case "error":
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `⚠ ${evt.message}`,
          status: "error",
        },
      ]);
      break;
  }
}

function stoppedReasonToText(reason: string): string {
  switch (reason) {
    case "hard_limit":
      return "⏱ Turn limit reached";
    case "consecutive_no":
      return "💤 No one picked it up. Try a more specific question?";
    case "user_interrupt":
      return "⏸ You interrupted the discussion";
    case "user_stop":
      return "⏹ Discussion stopped";
    default:
      return `⚠ Something went wrong (${reason})`;
  }
}
