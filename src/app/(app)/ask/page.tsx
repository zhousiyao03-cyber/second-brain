"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  Bookmark,
  Bot,
  FileText,
  Loader2,
  RefreshCcw,
  Save,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
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
  hint: string;
  prompt: string;
  scope: AskAiSourceScope;
}> = [
  {
    title: "Summarize recent notes",
    hint: "Compress what you wrote recently into the key takeaways.",
    prompt: "Summarize my recent notes",
    scope: "notes",
  },
  {
    title: "Review recent bookmarks",
    hint: "See what is worth revisiting from the materials you saved.",
    prompt: "What is worth revisiting from my recent bookmarks?",
    scope: "bookmarks",
  },
  {
    title: "Map the current project",
    hint: "Pull out the current project consensus from your knowledge base.",
    prompt: "What is the current tech stack of this project?",
    scope: "all",
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

function ScopeChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-sm transition-all",
        active
          ? "border-stone-900 bg-stone-900 text-white shadow-sm dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950"
          : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:border-stone-700 dark:hover:bg-stone-900"
      )}
    >
      {label}
    </button>
  );
}

function QuickPromptCard({
  title,
  hint,
  onClick,
}: {
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[28px] border border-stone-200 bg-white/85 px-4 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-950/80 dark:hover:border-stone-700 dark:hover:bg-stone-950"
    >
      <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
        {title}
      </div>
      <div className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
        {hint}
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
      className="inline-flex min-w-0 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:border-stone-700 dark:hover:bg-stone-900"
    >
      {isNote ? <FileText size={14} /> : <Bookmark size={14} />}
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
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-900 dark:hover:text-stone-100"
    >
      <Icon size={16} />
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
      type: "summary",
      tags: JSON.stringify(["ask-ai"]),
    });
  };

  return (
    <div className="flex min-h-full flex-col font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-1 flex-col">
        <div
          ref={messagesContainerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            messages.length > 0 ? "pb-36" : "pb-6"
          )}
        >
          {messages.length === 0 ? (
            <section className="flex flex-col items-center px-4 pb-8 pt-10 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                <Bot size={32} />
              </div>

              <h2 className="mt-8 text-[clamp(2rem,4vw,3.25rem)] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                What do you want to work on today?
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">
                Choose where to look first, then let answers, sources, and follow-up actions connect naturally.
              </p>
            </section>
          ) : (
            <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-2 pb-10 pt-6 sm:px-4">
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
                      <div className="max-w-[min(32rem,88%)] rounded-[28px] bg-stone-100 px-5 py-3 text-[15px] leading-7 text-stone-900 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-800">
                        <div className="whitespace-pre-wrap">{cleanText}</div>
                      </div>
                    </article>
                  );
                }

                return (
                  <article key={message.id} className="flex gap-4">
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm sm:flex dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                      <Bot size={18} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-stone-400 dark:text-stone-500">
                        Ask AI
                      </div>

                      <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-stone-800 dark:text-stone-100">
                        {cleanText || (isLoading ? "Preparing the answer..." : "")}
                      </div>

                      {isLatestAssistant && (
                        <div className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-[24px] border border-stone-200/80 bg-white/70 px-4 py-3 shadow-[0_12px_38px_-30px_rgba(15,23,42,0.45)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/70">
                          <div className="min-w-0 flex-1">
                            {sources.length === 0 ? (
                              <div className="text-sm text-stone-500 dark:text-stone-400">
                                {scope === "direct"
                                  ? "Direct answer mode is on, so no sources are shown."
                                  : "No displayable sources were attached to this answer."}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {sources.slice(0, 3).map((source) => (
                                  <SourcePill
                                    key={`${source.type}-${source.id}`}
                                    source={source}
                                  />
                                ))}
                                {sources.length > 3 ? (
                                  <div className="inline-flex items-center rounded-full bg-stone-100 px-3 py-2 text-sm text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                                    +{sources.length - 3} more
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
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
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                  <Loader2 size={16} className="animate-spin" />
                  Pulling together an answer from {currentScope.label}...
                </div>
              )}

              {errorMessage && (
                <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  Something went wrong: {errorMessage}
                </div>
              )}
            </section>
          )}
        </div>

        <div
          className={cn(
            "z-10",
            messages.length > 0
              ? "sticky bottom-0 bg-gradient-to-t from-stone-50 via-stone-50/98 to-transparent pb-3 pt-4 backdrop-blur dark:from-stone-950 dark:via-stone-950/98"
              : "mt-10 pb-8 pt-2"
          )}
        >
          <div className="mx-auto w-full max-w-4xl">
            <form
              onSubmit={handleSubmit}
              className={cn(
                "rounded-[34px] border bg-white/94 p-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur transition-all dark:bg-stone-950/92",
                isComposerFocused
                  ? "border-blue-500 shadow-[0_26px_70px_-40px_rgba(59,130,246,0.55)] dark:border-blue-500"
                  : "border-stone-200 dark:border-stone-800"
              )}
            >
              <div className="flex flex-wrap gap-2">
                {VISIBLE_SCOPE_OPTIONS.map((option) => (
                  <ScopeChip
                    key={option.value}
                    active={scope === option.value}
                    label={option.label}
                    onClick={() => setScope(option.value)}
                  />
                ))}
              </div>

              <div className="mt-4">
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
                  placeholder="Use AI to work through anything..."
                  rows={2}
                  className="min-h-[56px] w-full resize-none border-none bg-transparent text-[18px] leading-7 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                  disabled={isLoading}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-stone-500 dark:text-stone-400">
                  <span>{currentScope.description}</span>
                  <span className="hidden md:inline">
                    {" "}
                    · Enter to send, Shift+Enter for a new line
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        setMessages([]);
                      }}
                      disabled={isLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      <Trash2 size={14} />
                      Clear chat
                    </button>
                  )}

                  {isLoading && (
                    <button
                      type="button"
                      onClick={() => stop()}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                      <Square size={14} />
                      Stop
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </form>

            {messages.length > 0 ? (
              <div className="mt-2 text-center text-xs text-stone-400 dark:text-stone-500">
                AI can make mistakes. Verify important details.
              </div>
            ) : null}

            {messages.length === 0 && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {QUICK_PROMPTS.map((prompt) => (
                  <QuickPromptCard
                    key={prompt.title}
                    title={prompt.title}
                    hint={prompt.hint}
                    onClick={() =>
                      launchQuickPrompt(prompt.prompt, prompt.scope)
                    }
                  />
                ))}
              </div>
            )}
          </div>
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
    <div className="flex min-h-full flex-col font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-1 flex-col">
        <div
          ref={messagesContainerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            messages.length > 0 ? "pb-36" : "pb-6"
          )}
        >
          {messages.length === 0 ? (
            <section className="flex flex-col items-center px-4 pb-8 pt-10 text-center">
              <DaemonBanner />

              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                <Bot size={32} />
              </div>

              <h2 className="mt-8 text-[clamp(2rem,4vw,3.25rem)] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                What do you want to work on today?
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">
                Choose where to look first, then let answers, sources, and follow-up actions connect naturally.
              </p>
            </section>
          ) : (
            <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-2 pb-10 pt-6 sm:px-4">
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
                      <div className="max-w-[min(32rem,88%)] rounded-[28px] bg-stone-100 px-5 py-3 text-[15px] leading-7 text-stone-900 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-800">
                        <div className="whitespace-pre-wrap">{cleanText}</div>
                      </div>
                    </article>
                  );
                }

                return (
                  <article key={message.id} className="flex gap-4">
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm sm:flex dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                      <Bot size={18} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-stone-400 dark:text-stone-500">
                        Ask AI
                      </div>

                      <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-stone-800 dark:text-stone-100">
                        {cleanText || (isLoading ? "Preparing the answer..." : "")}
                      </div>

                      {isLatestAssistant && (
                        <div className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-[24px] border border-stone-200/80 bg-white/70 px-4 py-3 shadow-[0_12px_38px_-30px_rgba(15,23,42,0.45)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/70">
                          <div className="min-w-0 flex-1">
                            {sources.length === 0 ? (
                              <div className="text-sm text-stone-500 dark:text-stone-400">
                                {scope === "direct"
                                  ? "Direct answer mode is on, so no sources are shown."
                                  : "No displayable sources were attached to this answer."}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {sources.slice(0, 3).map((source) => (
                                  <SourcePill
                                    key={`${source.type}-${source.id}`}
                                    source={source}
                                  />
                                ))}
                                {sources.length > 3 ? (
                                  <div className="inline-flex items-center rounded-full bg-stone-100 px-3 py-2 text-sm text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                                    +{sources.length - 3} more
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
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
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                  <Loader2 size={16} className="animate-spin" />
                  Pulling together an answer from {currentScope.label}...
                </div>
              )}

              {errorMessage && (
                <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  Something went wrong: {errorMessage}
                </div>
              )}
            </section>
          )}
        </div>

        <div
          className={cn(
            "z-10",
            messages.length > 0
              ? "sticky bottom-0 bg-gradient-to-t from-stone-50 via-stone-50/98 to-transparent pb-3 pt-4 backdrop-blur dark:from-stone-950 dark:via-stone-950/98"
              : "mt-10 pb-8 pt-2"
          )}
        >
          <div className="mx-auto w-full max-w-4xl">
            <form
              onSubmit={handleSubmit}
              className={cn(
                "rounded-[34px] border bg-white/94 p-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur transition-all dark:bg-stone-950/92",
                isComposerFocused
                  ? "border-blue-500 shadow-[0_26px_70px_-40px_rgba(59,130,246,0.55)] dark:border-blue-500"
                  : "border-stone-200 dark:border-stone-800"
              )}
            >
              <div className="flex flex-wrap gap-2">
                {VISIBLE_SCOPE_OPTIONS.map((option) => (
                  <ScopeChip
                    key={option.value}
                    active={scope === option.value}
                    label={option.label}
                    onClick={() => setScope(option.value)}
                  />
                ))}
              </div>

              <div className="mt-4">
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
                  placeholder="Use AI to work through anything..."
                  rows={2}
                  className="min-h-[56px] w-full resize-none border-none bg-transparent text-[18px] leading-7 text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
                  disabled={isLoading}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-stone-500 dark:text-stone-400">
                  <span>{currentScope.description}</span>
                  <span className="hidden md:inline">
                    {" "}
                    · Enter to send, Shift+Enter for a new line
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => reset()}
                      disabled={isLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                    >
                      <Trash2 size={14} />
                      Clear chat
                    </button>
                  )}

                  {isLoading && (
                    <button
                      type="button"
                      onClick={() => stop()}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                      <Square size={14} />
                      Stop
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </form>

            {messages.length > 0 ? (
              <div className="mt-2 text-center text-xs text-stone-400 dark:text-stone-500">
                AI can make mistakes. Verify important details.
              </div>
            ) : null}

            {messages.length === 0 && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {QUICK_PROMPTS.map((prompt) => (
                  <QuickPromptCard
                    key={prompt.title}
                    title={prompt.title}
                    hint={prompt.hint}
                    onClick={() =>
                      launchQuickPrompt(prompt.prompt, prompt.scope)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AskPage() {
  const [chatMode, setChatMode] = useState<"daemon" | "stream" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => res.json())
      .then((data: { chatMode?: string }) => {
        if (!cancelled) {
          setChatMode(data.chatMode === "daemon" ? "daemon" : "stream");
        }
      })
      .catch(() => {
        if (!cancelled) setChatMode("stream");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (chatMode === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-stone-500">
        Loading...
      </div>
    );
  }

  if (chatMode === "daemon") {
    return <AskPageDaemon />;
  }

  return <AskPageStream />;
}
