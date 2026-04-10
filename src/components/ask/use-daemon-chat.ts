"use client";

import { useCallback, useRef, useState } from "react";
import type { AskAiSourceScope } from "@/lib/ask-ai";

export interface DaemonUIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export type DaemonChatStatus = "idle" | "submitting" | "streaming" | "error";

interface UseDaemonChatOptions {
  api: string;
  sourceScope: AskAiSourceScope;
}

export function useDaemonChat({ api, sourceScope }: UseDaemonChatOptions) {
  const [messages, setMessages] = useState<DaemonUIMessage[]>([]);
  const [status, setStatus] = useState<DaemonChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (status !== "idle") {
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);

      const userMsg: DaemonUIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setStatus("submitting");

      try {
        // 1. Enqueue task
        const enqueueRes = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.map((m) => ({
              role: m.role,
              parts: m.parts,
            })),
            sourceScope,
          }),
          signal: ac.signal,
        });

        if (!enqueueRes.ok) {
          const body = await enqueueRes.json().catch(() => ({}));
          throw new Error(body.error || `Chat enqueue failed: ${enqueueRes.status}`);
        }

        const enqueueBody = (await enqueueRes.json()) as {
          taskId?: string;
          mode?: string;
          error?: string;
        };

        if (!enqueueBody.taskId || enqueueBody.mode !== "daemon") {
          throw new Error(
            enqueueBody.error ||
              "Chat endpoint did not return a daemon taskId (is AI_PROVIDER=claude-code-daemon?)"
          );
        }

        const taskId = enqueueBody.taskId;
        const assistantId = crypto.randomUUID();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", parts: [{ type: "text", text: "" }] },
        ]);
        setStatus("streaming");

        // 2. Consume SSE stream from /api/chat/tokens
        let currentText = "";
        const updateAssistant = (t: string) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, parts: [{ type: "text", text: t }] }
                : msg
            )
          );
        };

        const sseUrl = `/api/chat/tokens?taskId=${encodeURIComponent(taskId)}&afterSeq=0`;
        const sseRes = await fetch(sseUrl, { signal: ac.signal });

        if (!sseRes.ok || !sseRes.body) {
          throw new Error(`SSE connection failed: ${sseRes.status}`);
        }

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop()!;

          for (const part of parts) {
            if (!part.trim()) continue;

            let eventType = "message";
            let dataStr = "";
            for (const line of part.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7);
              } else if (line.startsWith("data: ")) {
                dataStr = line.slice(6);
              }
            }

            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (eventType === "delta") {
                if (data.type === "text_delta" && data.delta != null) {
                  currentText += data.delta;
                  updateAssistant(currentText);
                } else if (data.type === "text_final" && data.delta != null) {
                  currentText = data.delta;
                  updateAssistant(currentText);
                }
              } else if (eventType === "done") {
                if (data.totalText && data.totalText !== currentText) {
                  currentText = data.totalText;
                  updateAssistant(currentText);
                }
                setStatus("idle");
                abortRef.current = null;
                return;
              } else if (eventType === "error") {
                throw new Error(data.error || "Daemon task failed");
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Daemon task failed") {
                // JSON parse error — skip
                continue;
              }
              throw e;
            }
          }
        }

        // Stream ended without explicit done — treat as complete
        setStatus("idle");
        abortRef.current = null;
      } catch (err) {
        if (ac.signal.aborted) return;
        setStatus("error");
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [api, messages, sourceScope, status]
  );

  return { messages, status, error, sendMessage, stop, reset };
}
