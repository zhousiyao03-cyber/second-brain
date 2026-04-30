/**
 * Wraps a "legacy" text/plain streaming Response (the kind that
 * `streamText().toTextStreamResponse()` and the codex provider both
 * produce) into a UI message stream Response — the envelope that
 * `DefaultChatTransport` on the front-end now expects.
 *
 * Why we need this: spec §5.3 lets us flip the front-end to
 * `DefaultChatTransport` once for every Ask AI surface, even though
 * codex / claude-code-daemon still run single-turn under the hood. The
 * adapter turns the raw text bytes into a single sequence:
 *
 *   start → start-step → text-start(id=t0) → text-delta(...) ... → text-end →
 *   finish-step → finish
 *
 * This is the minimum subset of `UIMessageChunk` that the AI SDK's
 * `DefaultChatTransport` parses into a single text part, which is exactly
 * what the legacy text-streaming providers always produced.
 *
 * No tool-call / tool-output chunks are emitted because the codex /
 * daemon paths don't have tools. If we ever bolt tool-calling onto codex
 * in Phase 2, this file is the seam to rewire.
 */

import { createUIMessageStreamResponse } from "ai";

const TEXT_PART_ID = "t0";

export function adaptTextStreamToUiMessageStream(
  legacy: Response,
): Response {
  // Surface upstream errors (401/429/etc.) without rewrapping them — the
  // route handler already emits JSON error responses for those, but if we
  // somehow get here with a non-stream body, hand it back unchanged so we
  // don't accidentally truncate diagnostic info.
  if (!legacy.body) {
    return legacy;
  }

  const upstream = legacy.body;
  const decoder = new TextDecoder();

  // Build a ReadableStream<UIMessageChunk> by transforming the raw text
  // bytes. We don't tee or buffer — bytes flow straight through.
  const uiStream = new ReadableStream<unknown>({
    async start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "start-step" });
      controller.enqueue({ type: "text-start", id: TEXT_PART_ID });

      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text.length > 0) {
            controller.enqueue({
              type: "text-delta",
              id: TEXT_PART_ID,
              delta: text,
            });
          }
        }
        // Flush any final bytes the decoder was holding.
        const tail = decoder.decode();
        if (tail.length > 0) {
          controller.enqueue({
            type: "text-delta",
            id: TEXT_PART_ID,
            delta: tail,
          });
        }
        controller.enqueue({ type: "text-end", id: TEXT_PART_ID });
        controller.enqueue({ type: "finish-step" });
        controller.enqueue({ type: "finish" });
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "stream error";
        controller.enqueue({ type: "error", errorText: message });
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      void upstream.cancel(reason);
    },
  });

  // `createUIMessageStreamResponse` does the JSON→SSE framing + sets
  // `content-type: text/event-stream` plus the `x-vercel-ai-ui-message-stream`
  // header that DefaultChatTransport keys off.
  return createUIMessageStreamResponse({
    stream: uiStream as ReadableStream<never>,
  });
}
