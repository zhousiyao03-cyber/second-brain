"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  ArrowUp,
  Bookmark,
  FileText,
  Loader2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { aiTextToTiptapJson } from "@/lib/ai-text-to-tiptap";
import {
  InlineAskAiMentionMenu,
  type MentionSource,
} from "./inline-ask-ai-mention-menu";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

const REWRITE_QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "更简洁", prompt: "让它更简洁，保留核心信息" },
  { label: "更易读", prompt: "改写得更清晰易读，分段或列表更合适" },
  { label: "翻译为中文", prompt: "翻译为自然的中文" },
  { label: "翻译为英文", prompt: "翻译为自然的英文" },
];

const ASK_QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "总结这篇笔记", prompt: "帮我用 3-5 个要点总结这篇笔记的主要内容" },
  { label: "列出待办", prompt: "从这篇笔记里抽出所有可操作的 TODO，用 bullet list 输出" },
  { label: "下一步建议", prompt: "基于这篇笔记的内容，给我 3 个具体的下一步建议" },
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
      ? `请根据下面的指令改写给定文本。只输出改写后的文本本身，不要加任何解释、前言或 markdown 标题。\n\n指令：${instruction}\n\n原文：\n${anchor.selectedText}`
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

  const handleInsert = () => {
    if (!lastAssistantText.trim()) return;
    const json = aiTextToTiptapJson(lastAssistantText);
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
        {isRewrite ? "改写选中文本" : "Ask AI"}
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
                  aria-label={`移除 ${source.title}`}
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
              ? "想怎么改写？（例如：更简洁、翻译为英文、改成列表）"
              : "问点什么，或用 @ 钉住 note/bookmark 作为上下文..."
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
              正在思考...
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="border-t border-red-100 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:text-red-400">
          出错了：{error.message || "未知错误"}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-3 py-2 dark:border-stone-800">
        <div className="text-[11px] text-stone-400 dark:text-stone-500">
          Enter 发送 · Esc 关闭
        </div>
        <div className="flex items-center gap-1.5">
          {isLoading && (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              <Square size={12} /> 停止
            </button>
          )}
          {lastAssistantText && !isLoading && (
            <>
              <button
                type="button"
                onClick={handleDiscard}
                className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                丢弃
              </button>
              <button
                type="button"
                onClick={handleInsert}
                className={cn(
                  "rounded-md bg-stone-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-stone-700",
                  "dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                )}
              >
                {isRewrite ? "替换" : "插入"}
              </button>
            </>
          )}
          {!lastAssistantText && !isLoading && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim()}
              aria-label="发送"
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
