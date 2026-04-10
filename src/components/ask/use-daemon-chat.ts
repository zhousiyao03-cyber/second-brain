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

const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 120 * 1000;

export function useDaemonChat({ api, sourceScope }: UseDaemonChatOptions) {
  const [messages, setMessages] = useState<DaemonUIMessage[]>([]);
  const [status, setStatus] = useState<DaemonChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setError(null);
    cancelRef.current = false;
  }, []);

  const stop = useCallback(() => {
    cancelRef.current = true;
    setStatus("idle");
  }, []);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (status !== "idle") {
        return;
      }

      cancelRef.current = false;
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

        let lastSeq = 0;
        let currentText = "";
        const startedAt = Date.now();

        while (true) {
          if (cancelRef.current) {
            return;
          }

          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            throw new Error(
              "Daemon task did not finish within 2 minutes. The local daemon may be offline."
            );
          }

          const tokenRes = await fetch(
            `/api/chat/tokens?taskId=${encodeURIComponent(taskId)}&afterSeq=${lastSeq}`
          );

          if (!tokenRes.ok) {
            throw new Error(`Token poll failed: ${tokenRes.status}`);
          }

          const tokenBody = (await tokenRes.json()) as {
            messages: Array<{
              seq: number;
              type: "text_delta" | "text_final" | "error";
              delta: string | null;
            }>;
            status: "queued" | "running" | "completed" | "failed";
            totalText?: string;
            error?: string;
          };

          for (const m of tokenBody.messages) {
            lastSeq = Math.max(lastSeq, m.seq);
            if (m.type === "text_delta" && m.delta != null) {
              currentText += m.delta;
            } else if (m.type === "text_final" && m.delta != null) {
              // text_final carries the canonical full text — use as-is
              // to correct any drift from missed or reordered deltas
              currentText = m.delta;
            }
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, parts: [{ type: "text", text: currentText }] }
                : msg
            )
          );

          if (tokenBody.status === "completed") {
            if (tokenBody.totalText && tokenBody.totalText !== currentText) {
              currentText = tokenBody.totalText;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, parts: [{ type: "text", text: currentText }] }
                    : msg
                )
              );
            }
            setStatus("idle");
            return;
          }

          if (tokenBody.status === "failed") {
            throw new Error(tokenBody.error || "Daemon task failed");
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [api, messages, sourceScope, status]
  );

  return { messages, status, error, sendMessage, stop, reset };
}
