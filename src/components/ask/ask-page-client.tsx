"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  ArrowUp,
  Bookmark,
  FileText,
  Loader2,
  Mic,
  Plus,
  RefreshCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { MarkdownRenderer } from "@/components/ask/markdown-renderer";
import {
  ASK_AI_SCOPE_OPTIONS,
  type AskAiSource,
  type AskAiSourceScope,
  parseAssistantResponse,
} from "@/lib/ask-ai";
import { trpc } from "@/lib/trpc";
import { cn, truncateText } from "@/lib/utils";
import { useDaemonChat } from "@/components/ask/use-daemon-chat";
import { DaemonBanner } from "@/components/ask/daemon-banner";

const QUICK_PROMPTS: Array<{
  title: string;
  icon: typeof Sparkles;
  prompt: string;
  scope: AskAiSourceScope;
}> = [
  {
    title: "Summarize recent notes",
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

const transport = new TextStreamChatTransport({ api: "/api/chat" });
const VISIBLE_SCOPE_OPTIONS = ASK_AI_SCOPE_OPTIONS.filter(
  (option) => option.value !== "bookmarks"
);

function getMessageText(parts: Array<{ type: string; text?: string }> = []) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function getReadableErrorMessage(error: Error | undefined | null) {
  const rawMessage = error?.message?.trim();
  if (!rawMessage) return null;

  try {
    const parsed = JSON.parse(rawMessage) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    return rawMessage;
  }

  return rawMessage;
}

function buildNoteDocument(
  question: string,
  answer: string,
  sources: AskAiSource[]
) {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Question" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: question }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Answer" }],
    },
    ...answer
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
  ];

  if (sources.length > 0) {
    blocks.push({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Sources" }],
    });

    for (const source of sources) {
      blocks.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: `${source.type === "note" ? "Note" : "Bookmark"}: ${
                      source.title
                    }`,
                  },
                ],
              },
            ],
          },
        ],
      });
    }
  }

  return JSON.stringify({
    type: "doc",
    content: blocks,
  });
}

function buildSavedPlainText(
  question: string,
  answer: string,
  sources: AskAiSource[]
) {
  const sourceLines =
    sources.length > 0
      ? `\n\nSources:\n${sources
          .map(
            (source) =>
              `- ${source.type === "note" ? "Note" : "Bookmark"}: ${source.title}`
          )
          .join("\n")}`
      : "";

  return `Question: ${question}\n\nAnswer:\n${answer}${sourceLines}`;
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
      >
        <SlidersHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-md border border-stone-200 bg-white py-1 shadow-md dark:border-stone-800 dark:bg-stone-950">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
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
                "block w-full px-3 py-1.5 text-left text-xs transition-colors",
                scope === option.value
                  ? "bg-stone-100 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-900"
              )}
            >
              <div className="font-medium">{option.label}</div>
              <div className="mt-0.5 text-[10px] leading-4 text-stone-400 dark:text-stone-500">
                {option.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickPromptCard({
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
      className="flex items-center gap-2 rounded-md border border-stone-200 bg-white/70 px-3 py-2 text-left transition-colors hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-950/50 dark:hover:border-stone-700 dark:hover:bg-stone-950"
    >
      <Icon size={13} className="shrink-0 text-stone-400 dark:text-stone-500" />
      <div className="truncate text-xs font-medium text-stone-700 dark:text-stone-300">
        {title}
      </div>
    </button>
  );
}

function SourcePill({
  source,
}: {
  source: AskAiSource;
}) {
  const isNote = source.type === "note";

  return (
    <Link
      href={isNote ? `/notes/${source.id}` : "/bookmarks"}
      className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
    >
      {isNote ? <FileText size={11} /> : <Bookmark size={11} />}
      <span className="max-w-[11rem] truncate">{source.title}</span>
    </Link>
  );
}

function IconActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Save;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-100"
    >
      <Icon size={13} />
    </button>
  );
}

function AskPageStream() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskAiSourceScope>("all");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isComposingRef = useRef<boolean>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    regenerate,
    status,
    error,
    clearError,
  } = useChat({
    transport,
  });

  const createNote = trpc.notes.create.useMutation({
    onSuccess: (data) => {
      utils.notes.list.invalidate();
      toast("Saved as note", "success");
      router.push(`/notes/${data.id}`);
    },
    onError: () => {
      toast("Failed to save note", "error");
    },
  });

  const isLoading = status === "streaming" || status === "submitted";
  const errorMessage = getReadableErrorMessage(error);

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const lastQuestion = lastUserMessage ? getMessageText(lastUserMessage.parts) : "";
  const lastAssistantRawText = lastAssistantMessage
    ? getMessageText(lastAssistantMessage.parts)
    : "";
  const latestAnswer = parseAssistantResponse(lastAssistantRawText);
  const currentScope = ASK_AI_SCOPE_OPTIONS.find((option) => option.value === scope)!;

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, status]);

  const submitPrompt = (prompt: string, nextScope = scope) => {
    if (isLoading) return;

    clearError();
    sendMessage({ text: prompt }, { body: { sourceScope: nextScope } });
    setInput("");
  };

  const launchQuickPrompt = (prompt: string, nextScope: AskAiSourceScope) => {
    setScope(nextScope);
    submitPrompt(prompt, nextScope);
  };

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    submitPrompt(trimmedInput);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleRegenerateWithScope = (nextScope: AskAiSourceScope) => {
    if (!lastUserMessage || isLoading) return;

    clearError();
    setScope(nextScope);
    regenerate({ body: { sourceScope: nextScope } });
  };

  const handleSaveAnswer = () => {
    if (!lastQuestion || !latestAnswer.cleanText.trim()) return;

    const title = `AI Q&A: ${truncateText(lastQuestion, 24)}`;
    createNote.mutate({
      title,
      content: buildNoteDocument(
        lastQuestion,
        latestAnswer.cleanText,
        latestAnswer.sources
      ),
      plainText: buildSavedPlainText(
        lastQuestion,
        latestAnswer.cleanText,
        latestAnswer.sources
      ),
    });
  };

  return (
    <div className="flex min-h-full flex-col text-stone-900 dark:text-stone-100">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-6">
        <div
          ref={messagesContainerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            messages.length > 0 ? "pb-36" : "pb-6"
          )}
        >
          {messages.length === 0 ? (
            <section className="flex flex-col items-center pb-6 pt-[14vh] text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <Sparkles size={18} />
              </div>

              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Your daily AI assistant.
              </h1>
            </section>
          ) : (
            <section className="flex w-full flex-col gap-5 pb-10 pt-6">
              {messages.map((message) => {
                const rawText = getMessageText(message.parts);
                const isAssistant = message.role === "assistant";
                const isLatestAssistant = message.id === lastAssistantMessage?.id;
                const { cleanText, sources } = isAssistant
                  ? parseAssistantResponse(rawText)
                  : { cleanText: rawText, sources: [] };

                if (!isAssistant) {
                  return (
                    <article key={message.id} className="flex justify-end">
                      <div className="max-w-[min(32rem,88%)] rounded-md bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-900 dark:bg-stone-900 dark:text-stone-100">
                        <div className="whitespace-pre-wrap">{cleanText}</div>
                      </div>
                    </article>
                  );
                }

                return (
                  <article key={message.id} className="min-w-0">
                    {cleanText ? (
                      <MarkdownRenderer content={cleanText} />
                    ) : isLoading ? (
                      <div className="text-sm leading-7 text-stone-600 dark:text-stone-300">
                        Thinking...
                      </div>
                    ) : null}

                    {isLatestAssistant && cleanText && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-stone-500">
                        <IconActionButton
                          icon={Save}
                          label="Save as note"
                          onClick={handleSaveAnswer}
                          disabled={
                            !latestAnswer.cleanText.trim() ||
                            createNote.isPending
                          }
                        />
                        <IconActionButton
                          icon={RefreshCcw}
                          label={`Regenerate (${currentScope.label})`}
                          onClick={() => handleRegenerateWithScope(scope)}
                          disabled={!lastUserMessage || isLoading}
                        />
                        {sources.length > 0 && (
                          <>
                            <span className="mx-1 h-3 w-px bg-stone-200 dark:bg-stone-800" />
                            {sources.slice(0, 3).map((source) => (
                              <SourcePill
                                key={`${source.type}-${source.id}`}
                                source={source}
                              />
                            ))}
                            {sources.length > 3 && (
                              <span className="px-1 text-[11px] text-stone-400">
                                +{sources.length - 3}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <Loader2 size={13} className="animate-spin" />
                  Thinking...
                </div>
              )}

              {errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  Error: {errorMessage}
                </div>
              )}
            </section>
          )}
        </div>

        <div
          className={cn(
            "z-10",
            messages.length > 0
              ? "sticky bottom-0 bg-gradient-to-t from-stone-50 via-stone-50/95 to-transparent pb-3 pt-4 backdrop-blur-xs dark:from-stone-950 dark:via-stone-950/95"
              : "-mt-4 pb-12"
          )}
        >
          <form
            onSubmit={handleSubmit}
            className={cn(
              "rounded-md border bg-white transition-colors dark:bg-stone-950",
              isComposerFocused
                ? "border-stone-400 dark:border-stone-600"
                : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
            )}
          >
            <div className="px-3 pt-2.5">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
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
                className="min-h-[24px] w-full resize-none border-none bg-transparent text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
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
                    onClick={() => {
                      clearError();
                      setMessages([]);
                    }}
                    title="Clear chat"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
                  >
                    <Trash2 size={13} />
                  </button>
                )}

                <span className="hidden px-1.5 text-[11px] text-stone-400 dark:text-stone-500 sm:inline">
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
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                  >
                    <Square size={12} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white dark:disabled:bg-stone-800 dark:disabled:text-stone-600"
                  >
                    <ArrowUp size={13} />
                  </button>
                )}
              </div>
            </div>
          </form>

          {messages.length > 0 ? (
            <div className="mt-2 text-center text-[11px] text-stone-400 dark:text-stone-500">
              AI may be inaccurate. Verify critical information.
            </div>
          ) : null}

          {messages.length === 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                Get started
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <QuickPromptCard
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
          )}
        </div>
      </div>
    </div>
  );
}

function AskPageDaemon() {
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskAiSourceScope>("all");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isComposingRef = useRef<boolean>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const { messages, status, error, sendMessage, stop, reset } = useDaemonChat({
    api: "/api/chat",
    sourceScope: scope,
  });

  const isLoading = status === "streaming" || status === "submitting";
  const errorMessage = getReadableErrorMessage(error);

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const currentScope = ASK_AI_SCOPE_OPTIONS.find((option) => option.value === scope)!;

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, status]);

  const launchQuickPrompt = (prompt: string, nextScope: AskAiSourceScope) => {
    if (isLoading) return;
    setScope(nextScope);
    sendMessage({ text: prompt });
    setInput("");
  };

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    sendMessage({ text: trimmedInput });
    setInput("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex min-h-full flex-col text-stone-900 dark:text-stone-100">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-6">
        <div
          ref={messagesContainerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            messages.length > 0 ? "pb-36" : "pb-6"
          )}
        >
          {messages.length === 0 ? (
            <section className="flex flex-col items-center pb-6 pt-[12vh] text-center">
              <DaemonBanner />

              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <Sparkles size={18} />
              </div>

              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Your daily AI assistant.
              </h2>
            </section>
          ) : (
            <section className="flex w-full flex-col gap-5 pb-10 pt-6">
              <DaemonBanner />

              {messages.map((message) => {
                const rawText = getMessageText(message.parts);
                const isAssistant = message.role === "assistant";
                const isLatestAssistant = message.id === lastAssistantMessage?.id;
                const { cleanText, sources } = isAssistant
                  ? parseAssistantResponse(rawText)
                  : { cleanText: rawText, sources: [] };

                if (!isAssistant) {
                  return (
                    <article key={message.id} className="flex justify-end">
                      <div className="max-w-[min(32rem,88%)] rounded-md bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-900 dark:bg-stone-900 dark:text-stone-100">
                        <div className="whitespace-pre-wrap">{cleanText}</div>
                      </div>
                    </article>
                  );
                }

                return (
                  <article key={message.id} className="min-w-0">
                    {cleanText ? (
                      <MarkdownRenderer content={cleanText} />
                    ) : isLoading ? (
                      <div className="text-sm leading-7 text-stone-600 dark:text-stone-300">
                        Thinking...
                      </div>
                    ) : null}

                    {isLatestAssistant && cleanText && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-stone-500">
                        <IconActionButton
                          icon={RefreshCcw}
                          label={`Regenerate (${currentScope.label})`}
                          onClick={() => {
                            if (!lastUserMessage || isLoading) return;
                            const lastQ = getMessageText(lastUserMessage.parts);
                            reset();
                            sendMessage({ text: lastQ });
                          }}
                          disabled={!lastUserMessage || isLoading}
                        />
                        {sources.length > 0 && (
                          <>
                            <span className="mx-1 h-3 w-px bg-stone-200 dark:bg-stone-800" />
                            {sources.slice(0, 3).map((source) => (
                              <SourcePill
                                key={`${source.type}-${source.id}`}
                                source={source}
                              />
                            ))}
                            {sources.length > 3 && (
                              <span className="px-1 text-[11px] text-stone-400">
                                +{sources.length - 3}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <Loader2 size={13} className="animate-spin" />
                  Thinking...
                </div>
              )}

              {errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  Error: {errorMessage}
                </div>
              )}
            </section>
          )}
        </div>

        <div
          className={cn(
            "z-10",
            messages.length > 0
              ? "sticky bottom-0 bg-gradient-to-t from-stone-50 via-stone-50/95 to-transparent pb-3 pt-4 backdrop-blur-xs dark:from-stone-950 dark:via-stone-950/95"
              : "-mt-4 pb-12"
          )}
        >
          <form
            onSubmit={handleSubmit}
            className={cn(
              "rounded-md border bg-white transition-colors dark:bg-stone-950",
              isComposerFocused
                ? "border-stone-400 dark:border-stone-600"
                : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
            )}
          >
            <div className="px-3 pt-2.5">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
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
                className="min-h-[24px] w-full resize-none border-none bg-transparent text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
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
                    onClick={() => reset()}
                    title="Clear chat"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
                  >
                    <Trash2 size={13} />
                  </button>
                )}

                <span className="hidden px-1.5 text-[11px] text-stone-400 dark:text-stone-500 sm:inline">
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
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                  >
                    <Square size={12} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white dark:disabled:bg-stone-800 dark:disabled:text-stone-600"
                  >
                    <ArrowUp size={13} />
                  </button>
                )}
              </div>
            </div>
          </form>

          {messages.length > 0 ? (
            <div className="mt-2 text-center text-[11px] text-stone-400 dark:text-stone-500">
              AI may be inaccurate. Verify critical information.
            </div>
          ) : null}

          {messages.length === 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                Get started
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <QuickPromptCard
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
          )}
        </div>
      </div>
    </div>
  );
}

export function AskPageClient({
  chatMode,
}: {
  chatMode: "daemon" | "stream";
}) {
  if (chatMode === "daemon") {
    return <AskPageDaemon />;
  }

  return <AskPageStream />;
}
