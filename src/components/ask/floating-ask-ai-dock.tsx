"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  ArrowUp,
  Bookmark,
  ExternalLink,
  FileText,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Mic,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  ASK_AI_SCOPE_OPTIONS,
  parseAssistantResponse,
  type AskAiSource,
  type AskAiSourceScope,
} from "@/lib/ask-ai";
import { cn } from "@/lib/utils";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

const VISIBLE_SCOPE_OPTIONS = ASK_AI_SCOPE_OPTIONS.filter(
  (option) => option.value !== "bookmarks"
);

const QUICK_PROMPTS: Array<{
  title: string;
  icon: typeof Sparkles;
  prompt: string;
  scope: AskAiSourceScope;
}> = [
  {
    title: "Search recent notes",
    icon: Sparkles,
    prompt: "Summarize my recent notes",
    scope: "notes",
  },
  {
    title: "Help me write something",
    icon: Wand2,
    prompt: "Help me draft something",
    scope: "direct",
  },
];

// Pages where the floating dock should NOT show (avoid duplication with
// the full-page Ask AI experience).
const HIDDEN_ON_PATHS = ["/ask"];

function getMessageText(parts: Array<{ type: string; text?: string }> = []) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function ScopeDropdown({
  scope,
  onChange,
}: {
  scope: AskAiSourceScope;
  onChange: (next: AskAiSourceScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = ASK_AI_SCOPE_OPTIONS.find((o) => o.value === scope)!;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Scope: ${current.label}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-800 dark:bg-stone-950">
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Knowledge Scope
          </div>
          {VISIBLE_SCOPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-3 py-2 text-left text-sm transition-colors",
                scope === option.value
                  ? "bg-stone-100 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-900"
              )}
            >
              <div className="font-medium">{option.label}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-stone-500 dark:text-stone-400">
                {option.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickPromptRow({
  title,
  icon: Icon,
  onClick,
}: {
  title: string;
  icon: typeof Sparkles;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
    >
      <Icon size={16} className="shrink-0 text-stone-500 dark:text-stone-400" />
      <span className="truncate">{title}</span>
    </button>
  );
}

function SourcePill({ source }: { source: AskAiSource }) {
  const isNote = source.type === "note";
  return (
    <Link
      href={isNote ? `/notes/${source.id}` : "/bookmarks"}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
    >
      {isNote ? <FileText size={12} /> : <Bookmark size={12} />}
      <span className="max-w-[11rem] truncate">{source.title}</span>
    </Link>
  );
}

export function FloatingAskAiDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskAiSourceScope>("all");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isComposingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, setMessages, stop, status, error, clearError } =
    useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";
  const isHidden = HIDDEN_ON_PATHS.some((p) => pathname?.startsWith(p));

  // Auto-scroll the message list as new content streams in.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  // Keyboard shortcut: Cmd/Ctrl + J toggles the dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (isHidden) return null;

  const currentScope = ASK_AI_SCOPE_OPTIONS.find((o) => o.value === scope)!;

  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  const submitPrompt = (prompt: string, nextScope = scope) => {
    if (isLoading) return;
    clearError();
    sendMessage({ text: prompt }, { body: { sourceScope: nextScope } });
    setInput("");
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    submitPrompt(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || isComposingRef.current) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const launchQuickPrompt = (prompt: string, nextScope: AskAiSourceScope) => {
    setScope(nextScope);
    submitPrompt(prompt, nextScope);
  };

  const handleNewChat = () => {
    clearError();
    setMessages([]);
    setInput("");
  };

  return (
    <>
      {/* Floating button (always visible unless panel open) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-lg transition-all hover:scale-105 hover:border-stone-300 hover:shadow-xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 dark:hover:border-stone-700"
        >
          <Sparkles size={20} />
        </button>
      )}

      {/* Dock panel */}
      {open && (
        <div
          data-floating-ask-ai-dock
          className="fixed bottom-6 right-6 z-40 flex h-[min(640px,calc(100vh-48px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-950"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 dark:border-stone-800">
            <div className="flex items-center gap-1.5 text-sm font-medium text-stone-900 dark:text-stone-100">
              <span>New AI chat</span>
            </div>
            <div className="flex items-center gap-0.5 text-stone-500 dark:text-stone-400">
              <button
                type="button"
                onClick={handleNewChat}
                title="New chat"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                <Pencil size={14} />
              </button>
              <Link
                href="/ask"
                title="Open full page"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                <ExternalLink size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Minimize"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                <Minus size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex flex-col px-5 pb-4 pt-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-950">
                  <Sparkles
                    size={20}
                    className="text-stone-700 dark:text-stone-200"
                  />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                  Your daily AI assistant.
                </h2>
                <div className="mt-6 space-y-0.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <QuickPromptRow
                      key={prompt.title}
                      title={prompt.title}
                      icon={prompt.icon}
                      onClick={() =>
                        launchQuickPrompt(prompt.prompt, prompt.scope)
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-4 py-4">
                {messages.map((message) => {
                  const rawText = getMessageText(
                    message.parts as Array<{ type: string; text?: string }>
                  );
                  const isAssistant = message.role === "assistant";
                  const { cleanText, sources } = isAssistant
                    ? parseAssistantResponse(rawText)
                    : { cleanText: rawText, sources: [] };
                  const isLatestAssistant =
                    message.id === lastAssistantMessage?.id;

                  if (!isAssistant) {
                    return (
                      <article key={message.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl bg-stone-100 px-3.5 py-1.5 text-[14px] leading-6 text-stone-900 dark:bg-stone-900 dark:text-stone-100">
                          <div className="whitespace-pre-wrap">{cleanText}</div>
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article key={message.id} className="min-w-0">
                      <div className="whitespace-pre-wrap text-[14px] leading-6 text-stone-800 dark:text-stone-100">
                        {cleanText || (isLoading ? "Thinking..." : "")}
                      </div>
                      {isLatestAssistant && cleanText && sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                          {sources.slice(0, 3).map((source) => (
                            <SourcePill
                              key={`${source.type}-${source.id}`}
                              source={source}
                            />
                          ))}
                          {sources.length > 3 && (
                            <span className="px-1 text-xs text-stone-400">
                              +{sources.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}

                {isLoading &&
                  messages[messages.length - 1]?.role === "user" && (
                    <div className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500">
                      <Loader2 size={14} className="animate-spin" />
                      Thinking...
                    </div>
                  )}

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    Error: {error.message || "Unknown error"}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-stone-100 p-3 dark:border-stone-800">
            <form
              onSubmit={handleSubmit}
              className={cn(
                "rounded-xl border bg-white transition-all dark:bg-stone-950",
                isComposerFocused
                  ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)] dark:border-blue-500"
                  : "border-stone-200 dark:border-stone-800"
              )}
            >
              <div className="px-3 pt-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setIsComposerFocused(true)}
                  onBlur={() => setIsComposerFocused(false)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                  }}
                  placeholder="Ask AI anything..."
                  rows={1}
                  disabled={isLoading}
                  className="min-h-[24px] w-full resize-none border-none bg-transparent text-[14px] leading-6 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                />
              </div>
              <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 pt-1">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled
                    title="Attachments (coming soon)"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 disabled:cursor-not-allowed dark:text-stone-600"
                  >
                    <Plus size={14} />
                  </button>
                  <ScopeDropdown scope={scope} onChange={setScope} />
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && !isLoading && (
                    <button
                      type="button"
                      onClick={handleNewChat}
                      title="Clear chat"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <span className="hidden px-1 text-[11px] text-stone-500 dark:text-stone-400 sm:inline">
                    {currentScope.label}
                  </span>
                  <button
                    type="button"
                    disabled
                    title="Voice input (coming soon)"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 disabled:cursor-not-allowed dark:text-stone-600"
                  >
                    <Mic size={13} />
                  </button>
                  {isLoading ? (
                    <button
                      type="button"
                      onClick={() => stop()}
                      title="Stop"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                    >
                      <Square size={12} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      aria-label="Send"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
                    >
                      <ArrowUp size={13} />
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
