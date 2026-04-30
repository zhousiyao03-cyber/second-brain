"use client";

/**
 * Renders a UI message's `parts[]` for the Ask AI surfaces. Spec §4.6.
 *
 * The AI SDK now emits a typed sequence of parts:
 *   - `text` — model output, rendered as markdown via the existing
 *     <MarkdownRenderer>. Adjacent `text` parts are concatenated before
 *     parsing so the `<!-- sources:... -->` trailer is recognized even
 *     when the model split it across deltas.
 *   - `tool-fetchUrl` — RED badge, full URL shown so the user can spot
 *     and stop suspicious URLs (data exfil via prompt injection).
 *   - `tool-searchKnowledge` / `tool-readNote` / any other `tool-*` —
 *     gray "step" badge.
 *
 * Rendering ordering is preserved: parts come out in the order the
 * server-side loop produced them, so the user sees
 *   "Searching knowledge..." → snippet of the answer → "Reading note..."
 *   → final answer
 * exactly the way it was generated.
 */

import { Globe, Loader2, Search, FileText, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { MarkdownRenderer } from "@/components/ask/markdown-renderer";
import { parseAssistantResponse } from "@/lib/ask-ai";
import { cn } from "@/lib/utils";

type Part = UIMessage["parts"][number];

type ToolPart = Extract<Part, { type: `tool-${string}` }> & {
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function ToolStepBadge({ part }: { part: ToolPart }) {
  // Tool name lives in the part type after the `tool-` prefix.
  const toolName = part.type.replace(/^tool-/, "");
  const Icon =
    toolName === "searchKnowledge"
      ? Search
      : toolName === "readNote"
        ? FileText
        : Wrench;
  const isRunning =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === undefined;
  const isError =
    part.state === "output-error" || Boolean(part.errorText);

  // Show a one-line summary of the inputs so the user has a sense of what
  // the agent is doing. We keep it tight (a single string) and let the
  // user inspect Langfuse for the full payload.
  const inputSummary = (() => {
    if (!part.input || typeof part.input !== "object") return null;
    const obj = part.input as Record<string, unknown>;
    if (typeof obj.query === "string") return obj.query;
    if (typeof obj.noteId === "string") return obj.noteId;
    return null;
  })();

  return (
    <div
      className={cn(
        "my-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
        isError
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300",
      )}
    >
      {isRunning ? (
        <Loader2 size={11} className="animate-spin shrink-0" />
      ) : (
        <Icon size={11} className="shrink-0" />
      )}
      <span className="font-medium">{toolName}</span>
      {inputSummary && (
        <span className="truncate text-stone-500 dark:text-stone-400">
          · {inputSummary}
        </span>
      )}
      {isError && part.errorText && (
        <span className="truncate"> · {part.errorText}</span>
      )}
    </div>
  );
}

function FetchUrlBadge({ part }: { part: ToolPart }) {
  const inputUrl = (() => {
    if (!part.input || typeof part.input !== "object") return "";
    const obj = part.input as Record<string, unknown>;
    return typeof obj.url === "string" ? obj.url : "";
  })();
  const isRunning =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === undefined;

  return (
    <div className="my-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-red-500 bg-red-50 px-2 py-1 text-[11px] text-red-800 dark:bg-red-950/40 dark:text-red-300">
      {isRunning ? (
        <Loader2 size={11} className="animate-spin shrink-0" />
      ) : (
        <Globe size={11} className="shrink-0" />
      )}
      <span className="font-semibold">fetchUrl</span>
      {inputUrl && (
        <span className="truncate font-mono">· {inputUrl}</span>
      )}
    </div>
  );
}

export interface ChatMessagePartsProps {
  parts: UIMessage["parts"];
  /** When true, strip the hidden `<!-- sources:... -->` trailer from text */
  stripAssistantSources?: boolean;
}

/**
 * Concatenate all text parts so we can run `parseAssistantResponse` once
 * and feed the cleaned markdown into <MarkdownRenderer>. Tool / fetchUrl
 * parts are interleaved in the output so the badges appear in-flow.
 */
export function ChatMessageParts({
  parts,
  stripAssistantSources = false,
}: ChatMessagePartsProps) {
  // First pass: build the rendered list, deferring text concatenation so
  // we can run `parseAssistantResponse` on the final glued text.
  const rendered: React.ReactNode[] = [];
  let textBuffer = "";
  let textBufferIndex = -1;

  const flushText = (key: string) => {
    if (textBuffer.length === 0) return;
    const finalText = stripAssistantSources
      ? parseAssistantResponse(textBuffer).cleanText
      : textBuffer;
    if (finalText.trim().length > 0) {
      rendered.push(
        <MarkdownRenderer key={`${key}-text-${textBufferIndex}`} content={finalText} />,
      );
    }
    textBuffer = "";
  };

  parts.forEach((rawPart, index) => {
    const part = rawPart as Part & { type: string };
    if (part.type === "text") {
      const text = (part as { text?: string }).text ?? "";
      if (textBufferIndex === -1) textBufferIndex = index;
      textBuffer += text;
      return;
    }
    flushText(`pre-${index}`);
    textBufferIndex = -1;

    if (part.type === "tool-fetchUrl") {
      rendered.push(
        <FetchUrlBadge key={`tool-${index}`} part={part as ToolPart} />,
      );
      return;
    }
    if (part.type.startsWith("tool-")) {
      rendered.push(
        <ToolStepBadge key={`tool-${index}`} part={part as ToolPart} />,
      );
      return;
    }
    // Unknown part types (reasoning, source-url, file, etc.) are ignored
    // for now — Phase 2 can light them up if we ever turn on reasoning
    // tokens or attachments.
  });

  flushText("final");

  return <>{rendered}</>;
}

/**
 * Helper for callers that need the concatenated raw text (without
 * markdown-render) — e.g. the "save as note" action that needs a clean
 * plain-text answer body. Tool parts contribute nothing.
 */
export function getMessageText(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is Part & { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
