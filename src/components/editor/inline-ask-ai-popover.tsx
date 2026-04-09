"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { aiTextToTiptapJson } from "@/lib/ai-text-to-tiptap";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

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

export function InlineAskAiPopover({
  editor,
  anchor,
  onClose,
  noteText,
}: Props) {
  const [input, setInput] = useState("");
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

  // Reset state whenever a new anchor opens the popover.
  useEffect(() => {
    if (anchor) {
      setInput("");
      setMessages([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [anchor, setMessages]);

  // Close on Escape / click outside.
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [anchor, onClose]);

  if (!anchor) return null;

  const isRewrite = Boolean(anchor.selectedText);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const finalPrompt = isRewrite
      ? `请根据下面的指令改写给定文本。只输出改写后的文本本身，不要加任何解释、前言或 markdown 标题。\n\n指令：${trimmed}\n\n原文：\n${anchor.selectedText}`
      : trimmed;

    sendMessage(
      { text: finalPrompt },
      {
        body: {
          sourceScope: "direct",
          contextNoteText: noteText.slice(0, 8000),
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || isComposingRef.current) return;
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

      <div className="px-3 pt-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
              : "问点什么，或让 AI 帮你写..."
          }
          rows={2}
          disabled={isLoading}
          className="w-full resize-none border-none bg-transparent text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
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
