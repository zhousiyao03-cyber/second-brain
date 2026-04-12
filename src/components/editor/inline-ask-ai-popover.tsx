"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  ArrowUp,
  Bookmark,
  Check,
  Copy,
  FileText,
  Loader2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { aiTextToTiptapJson } from "@/lib/ai-text-to-tiptap";
import { parseAiBlocks } from "@/lib/parse-ai-blocks";
import { stripAssistantSourceMetadata } from "@/lib/ask-ai";
import type { JSONContent } from "@tiptap/react";
import { InlineAskAiAppendTargetMenu } from "./inline-ask-ai-append-target-menu";
import {
  InlineAskAiMentionMenu,
  type MentionSource,
} from "./inline-ask-ai-mention-menu";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

const REWRITE_QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "More concise", prompt: "Make it more concise, keep the key information" },
  { label: "More readable", prompt: "Rewrite to be clearer and more readable, use paragraphs or lists as appropriate" },
  { label: "Translate to Chinese", prompt: "Translate to natural Chinese" },
  { label: "Translate to English", prompt: "Translate to natural English" },
];

const ASK_QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Summarize this note", prompt: "Summarize the main content of this note in 3-5 key points" },
  { label: "Extract TODOs", prompt: "Extract all actionable TODOs from this note, output as a bullet list" },
  { label: "Next steps", prompt: "Based on the content of this note, give me 3 specific next-step suggestions" },
];

export interface InlineAskAiAnchor {
  /** Document position where the popover is anchored (insertion point). */
  pos: number;
  /** Viewport coords for positioning the popover. */
  top: number;
  left: number;
  /** Optional: the selected text that should become the "rewrite target". */
  selectedText?: string;
  /** Optional: selection range (for replace action). */
  selectionFrom?: number;
  selectionTo?: number;
}

interface Props {
  editor: Editor;
  anchor: InlineAskAiAnchor | null;
  onClose: () => void;
  /** Full plain text of the current note for system-prompt context. */
  noteText: string;
}

function getMessageText(parts: Array<{ type: string; text?: string }> = []) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * Given the current textarea value and caret position, return the active
 * @mention query string (chars between the most recent `@` and the caret),
 * or `null` if the caret is not inside a mention token.
 *
 * Rules:
 *  - `@` must be at the start of the value or preceded by whitespace.
 *  - The span from `@` to caret must not contain whitespace/newlines.
 *  - Returns the query without the leading `@`. Empty string means the user
 *    just typed `@` with nothing after it.
 */
export function detectMentionQuery(
  value: string,
  caret: number
): { query: string; start: number } | null {
  if (caret < 1) return null;

  // Walk backwards from caret to find the nearest `@` that is a valid trigger.
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i > 0 ? value[i - 1] : "";
      if (i === 0 || /\s/.test(prev)) {
        return { query: value.slice(i + 1, caret), start: i };
      }
      return null;
    }
    if (ch === " " || ch === "\n" || ch === "\t") {
      return null;
    }
  }
  return null;
}

export function InlineAskAiPopover({
  editor,
  anchor,
  onClose,
  noteText,
}: Props) {
  const [input, setInput] = useState("");
  const [pinnedSources, setPinnedSources] = useState<MentionSource[]>([]);
  const [mentionState, setMentionState] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [appendMenuOpen, setAppendMenuOpen] = useState(false);
  const [appendMenuQuery, setAppendMenuQuery] = useState("");
  const [appendStatus, setAppendStatus] = useState<
    | { state: "idle" }
    | { state: "appending"; title: string }
    | { state: "appended"; title: string }
    | { state: "error"; message: string }
  >({ state: "idle" });

  const appendBlocksMutation = trpc.notes.appendBlocks.useMutation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const lastAssistantText = lastAssistant
    ? getMessageText(
        lastAssistant.parts as Array<{ type: string; text?: string }>
      )
    : "";

  // Autofocus the textarea when the popover mounts. Callers should give this
  // component a unique `key` per opening (e.g. keyed by anchor identity) so
  // every open starts with a fresh state tree — that's how we reset input /
  // pinnedSources / mentionState without touching them from an effect.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape / click outside.
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // When the mention menu is open, let it eat the Escape and close
        // itself instead of closing the whole popover.
        if (mentionState) return;
        e.preventDefault();
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Delay attach so the same click that opened us doesn't immediately close.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [anchor, onClose, mentionState]);

  if (!anchor) return null;

  const isRewrite = Boolean(anchor.selectedText);

  const sendPrompt = (instruction: string) => {
    if (!instruction.trim() || isLoading) return;
    const finalPrompt = isRewrite
      ? `Rewrite the given text according to the instruction below. Only output the rewritten text itself, without any explanation, preamble, or markdown headings.\n\nInstruction: ${instruction}\n\nOriginal text:\n${anchor.selectedText}`
      : instruction;

    sendMessage(
      { text: finalPrompt },
      {
        body: {
          sourceScope: "direct",
          contextNoteText: noteText.slice(0, 8000),
          pinnedSources: pinnedSources.map((s) => ({
            id: s.id,
            type: s.type,
          })),
          // M3: ask the model to emit <ai_blocks> JSON when the answer
          // has structure. parseAiBlocks() handles both paths.
          preferStructuredBlocks: true,
        },
      }
    );
  };

  const handleSubmit = () => {
    sendPrompt(input.trim());
  };

  const handleQuickAction = (preset: string) => {
    if (isLoading) return;
    setInput(preset);
    sendPrompt(preset);
  };

  const handleTextareaChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setInput(value);
    setMentionState(detectMentionQuery(value, caret));
  };

  const handleSelectMention = (source: MentionSource) => {
    // De-dupe by id.
    setPinnedSources((prev) =>
      prev.some((s) => s.id === source.id) ? prev : [...prev, source]
    );
    // Cut the `@query` token out of the input.
    if (mentionState) {
      const before = input.slice(0, mentionState.start);
      const afterStart = mentionState.start + 1 + mentionState.query.length;
      const after = input.slice(afterStart);
      // Collapse an orphan leading space that would otherwise double up.
      const next = `${before}${after}`;
      setInput(next);
    }
    setMentionState(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRemovePinned = (id: string) => {
    setPinnedSources((prev) => prev.filter((s) => s.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || isComposingRef.current) return;
    // While the mention menu is open, let it handle Enter / ↑ / ↓ / Esc and
    // don't submit the whole message.
    if (mentionState) {
      if (
        e.key === "Enter" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Escape"
      ) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /**
   * Turn the current assistant answer into Tiptap block JSON. Prefers the
   * structured `<ai_blocks>` payload if the model emitted one, otherwise
   * falls back to the minimal Markdown→JSON converter used since M1.
   */
  const answerToBlocks = (text: string): JSONContent[] => {
    const parsed = parseAiBlocks(text);
    if (parsed.blocks && parsed.blocks.length > 0) return parsed.blocks;
    return aiTextToTiptapJson(parsed.cleanText);
  };

  const handleInsert = () => {
    if (!lastAssistantText.trim()) return;
    const json = answerToBlocks(lastAssistantText);
    if (json.length === 0) return;

    if (
      isRewrite &&
      anchor.selectionFrom != null &&
      anchor.selectionTo != null
    ) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: anchor.selectionFrom, to: anchor.selectionTo })
        .insertContentAt(anchor.selectionFrom, json)
        .run();
    } else {
      editor.chain().focus().insertContentAt(anchor.pos, json).run();
    }
    onClose();
  };

  const handleAppendHere = () => {
    if (!lastAssistantText.trim()) return;
    const json = answerToBlocks(lastAssistantText);
    if (json.length === 0) return;
    const endPos = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(endPos, json).run();
    onClose();
  };

  const handleAppendToOther = async (target: { id: string; title: string }) => {
    if (!lastAssistantText.trim()) return;
    const json = answerToBlocks(lastAssistantText);
    if (json.length === 0) return;
    setAppendMenuOpen(false);
    setAppendMenuQuery("");
    setAppendStatus({ state: "appending", title: target.title });
    try {
      await appendBlocksMutation.mutateAsync({
        noteId: target.id,
        blocks: json,
      });
      setAppendStatus({ state: "appended", title: target.title });
      setTimeout(
        () => setAppendStatus({ state: "idle" }),
        2500
      );
    } catch (err) {
      setAppendStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Failed to append",
      });
    }
  };

  const handleCopy = async () => {
    if (!lastAssistantText.trim()) return;
    const parsed = parseAiBlocks(lastAssistantText);
    const textToCopy = stripAssistantSourceMetadata(parsed.cleanText).trim();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      // Clipboard may be blocked in some environments; silently ignore.
    }
  };

  const handleDiscard = () => {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  // Clamp popover to viewport so it doesn't clip on the right/bottom edge.
  const POPOVER_WIDTH = 520;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8)
  );
  const top = Math.min(anchor.top, window.innerHeight - 200);

  return (
    <div
      ref={containerRef}
      data-inline-ask-ai
      className="fixed z-50 w-[min(520px,calc(100vw-16px))] rounded-xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-950"
      style={{ top, left }}
    >
      <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-2 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
        <Sparkles size={14} />
        {isRewrite ? "Rewrite selection" : "Ask AI"}
      </div>

      {!lastAssistantText && !isLoading && (
        <div
          data-inline-ask-ai-quick-actions
          className="flex flex-wrap gap-1.5 border-b border-stone-100 px-3 py-2 dark:border-stone-800"
        >
          {(isRewrite ? REWRITE_QUICK_ACTIONS : ASK_QUICK_ACTIONS).map(
            (action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => handleQuickAction(action.prompt)}
                className="rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-[11px] text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800"
              >
                {action.label}
              </button>
            )
          )}
        </div>
      )}

      {pinnedSources.length > 0 && (
        <div
          data-inline-ask-ai-pinned-bar
          className="flex flex-wrap items-center gap-1.5 border-b border-stone-100 px-3 py-2 dark:border-stone-800"
        >
          {pinnedSources.map((source) => {
            const Icon = source.type === "note" ? FileText : Bookmark;
            return (
              <span
                key={source.id}
                data-pinned-source-id={source.id}
                className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200"
              >
                <Icon size={11} className="shrink-0" />
                <span className="truncate">{source.title}</span>
                <button
                  type="button"
                  onClick={() => handleRemovePinned(source.id)}
                  aria-label={`Remove ${source.title}`}
                  className="ml-0.5 shrink-0 rounded-full p-0.5 text-sky-600 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative px-3 pt-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder={
            isRewrite
              ? "How to rewrite? (e.g., more concise, translate to English, make a list)"
              : "Ask anything, or use @ to pin a note/bookmark as context..."
          }
          rows={2}
          disabled={isLoading}
          className="w-full resize-none border-none bg-transparent text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
        {mentionState && (
          <InlineAskAiMentionMenu
            query={mentionState.query}
            onSelect={handleSelectMention}
            onClose={() => setMentionState(null)}
          />
        )}
      </div>

      {(lastAssistantText || isLoading) && (
        <div className="max-h-60 overflow-y-auto border-t border-stone-100 px-3 py-3 text-sm leading-6 text-stone-800 dark:border-stone-800 dark:text-stone-100">
          {lastAssistantText ? (
            <div className="whitespace-pre-wrap">{lastAssistantText}</div>
          ) : (
            <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
              <Loader2 size={14} className="animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="border-t border-red-100 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:text-red-400">
          Error: {error.message || "Unknown error"}
        </div>
      )}

      {appendStatus.state !== "idle" && (
        <div
          data-inline-ask-ai-append-status
          className={cn(
            "border-t px-3 py-2 text-xs",
            appendStatus.state === "error"
              ? "border-red-100 text-red-600 dark:border-red-900 dark:text-red-400"
              : "border-stone-100 text-stone-500 dark:border-stone-800 dark:text-stone-400"
          )}
        >
          {appendStatus.state === "appending" && (
            <>Appending to "{appendStatus.title}"...</>
          )}
          {appendStatus.state === "appended" && (
            <>Appended to "{appendStatus.title}" ✓</>
          )}
          {appendStatus.state === "error" && (
            <>Failed to append: {appendStatus.message}</>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-3 py-2 dark:border-stone-800">
        <div className="text-[11px] text-stone-400 dark:text-stone-500">
          Enter to send · Esc to close
        </div>
        <div className="flex items-center gap-1.5">
          {isLoading && (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              <Square size={12} /> Stop
            </button>
          )}
          {lastAssistantText && !isLoading && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                data-inline-ask-ai-copy
                aria-label="Copy"
                title={copyStatus === "copied" ? "Copied" : "Copy"}
                className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                {copyStatus === "copied" ? (
                  <Check size={12} />
                ) : (
                  <Copy size={12} />
                )}
                <span>{copyStatus === "copied" ? "Copied" : "Copy"}</span>
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                Discard
              </button>
              {!isRewrite && (
                <button
                  type="button"
                  onClick={handleAppendHere}
                  data-inline-ask-ai-append
                  className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
                >
                  Append to end
                </button>
              )}
              {!isRewrite && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setAppendMenuOpen((prev) => !prev);
                      setAppendMenuQuery("");
                    }}
                    data-inline-ask-ai-append-to-other
                    className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
                  >
                    Append to...
                  </button>
                  {appendMenuOpen && (
                    <InlineAskAiAppendTargetMenu
                      query={appendMenuQuery}
                      onQueryChange={setAppendMenuQuery}
                      onSelect={(target) => {
                        void handleAppendToOther(target);
                      }}
                      onClose={() => setAppendMenuOpen(false)}
                    />
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={handleInsert}
                data-inline-ask-ai-primary
                className={cn(
                  "rounded-md bg-stone-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-stone-700",
                  "dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                )}
              >
                {isRewrite ? "Replace" : "Insert"}
              </button>
            </>
          )}
          {!lastAssistantText && !isLoading && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim()}
              aria-label="Send"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
            >
              <ArrowUp size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
