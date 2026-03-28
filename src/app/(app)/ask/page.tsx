"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  ArrowUpRight,
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

const QUICK_PROMPTS: Array<{
  title: string;
  hint: string;
  prompt: string;
  scope: AskAiSourceScope;
}> = [
  {
    title: "总结最近笔记",
    hint: "把最近写下来的内容压缩成重点。",
    prompt: "帮我总结一下最近的笔记",
    scope: "notes",
  },
  {
    title: "回顾最近收藏",
    hint: "看看这段时间收进来的资料有什么价值。",
    prompt: "最近收藏里有什么值得回顾的内容？",
    scope: "bookmarks",
  },
  {
    title: "梳理当前项目",
    hint: "从现有知识库里提炼项目共识。",
    prompt: "这个项目目前的技术栈是什么？",
    scope: "all",
  },
];

const transport = new TextStreamChatTransport({ api: "/api/chat" });

function getMessageText(parts: Array<{ type: string; text?: string }> = []) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function getReadableErrorMessage(error: Error | undefined) {
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
      content: [{ type: "text", text: "问题" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: question }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "回答" }],
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
      content: [{ type: "text", text: "引用来源" }],
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
                    text: `${source.type === "note" ? "笔记" : "收藏"}：${
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
      ? `\n\n引用来源：\n${sources
          .map(
            (source) =>
              `- ${source.type === "note" ? "笔记" : "收藏"}：${source.title}`
          )
          .join("\n")}`
      : "";

  return `问题：${question}\n\n回答：\n${answer}${sourceLines}`;
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

function ActionButton({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: typeof Save;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-[24px] border border-stone-200 bg-white px-4 py-3 text-left transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
    >
      <div>
        <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
          {label}
        </div>
        <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">
          {description}
        </div>
      </div>
      <Icon size={16} className="text-stone-400" />
    </button>
  );
}

export default function AskPage() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskAiSourceScope>("all");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isComposingRef = useRef(false);
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
      toast("已保存为笔记", "success");
      router.push(`/notes/${data.id}`);
    },
    onError: () => {
      toast("保存笔记失败", "error");
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

    const title = `AI 问答：${truncateText(lastQuestion, 24)}`;
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
          className="flex-1 overflow-y-auto pb-6"
        >
          {messages.length === 0 ? (
            <section className="flex flex-col items-center px-4 pb-8 pt-10 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                <Bot size={32} />
              </div>

              <h2 className="mt-8 text-[clamp(2rem,4vw,3.25rem)] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                今天想处理什么？
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">
                先决定从哪里找，再让回答、来源和沉淀动作自然接起来。
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
                        {cleanText || (isLoading ? "正在整理回答..." : "")}
                      </div>

                      {isLatestAssistant && (
                        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                          <section className="rounded-[30px] border border-stone-200 bg-white/90 p-5 shadow-[0_16px_45px_-32px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/90">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
                              引用来源
                            </div>

                            {sources.length === 0 ? (
                              <div className="mt-4 rounded-[24px] bg-stone-50 px-4 py-4 text-sm leading-6 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                                {scope === "direct"
                                  ? "当前是直接回答模式，这一轮不会展示知识库来源。"
                                  : "这一轮回答没有附带可展示的来源。"}
                              </div>
                            ) : (
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {sources.map((source) => (
                                  <Link
                                    key={`${source.type}-${source.id}`}
                                    href={
                                      source.type === "note"
                                        ? `/notes/${source.id}`
                                        : "/bookmarks"
                                    }
                                    className="group rounded-[24px] border border-stone-200 px-4 py-4 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                                  >
                                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                                      {source.type === "note" ? (
                                        <FileText size={12} />
                                      ) : (
                                        <Bookmark size={12} />
                                      )}
                                      {source.type === "note" ? "笔记" : "收藏"}
                                    </div>
                                    <div className="mt-3 text-sm font-medium leading-6 text-stone-900 dark:text-stone-100">
                                      {source.title}
                                    </div>
                                    <div className="mt-3 inline-flex items-center gap-1 text-xs text-stone-500 transition-colors group-hover:text-stone-900 dark:group-hover:text-stone-100">
                                      打开来源
                                      <ArrowUpRight size={12} />
                                    </div>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </section>

                          <section className="rounded-[30px] border border-stone-200 bg-white/90 p-5 shadow-[0_16px_45px_-32px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/90">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
                              继续工作
                            </div>

                            <div className="mt-4 space-y-3">
                              <ActionButton
                                icon={Save}
                                label="保存为笔记"
                                description="把当前问答沉淀成一条 `summary` 笔记，继续编辑。"
                                onClick={handleSaveAnswer}
                                disabled={
                                  !latestAnswer.cleanText.trim() ||
                                  createNote.isPending
                                }
                              />

                              <ActionButton
                                icon={RefreshCcw}
                                label="按当前范围重答"
                                description={`继续使用“${currentScope.label}”重新组织回答。`}
                                onClick={() => handleRegenerateWithScope(scope)}
                                disabled={!lastUserMessage || isLoading}
                              />
                            </div>

                            <div className="mt-6">
                              <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                                切换思路
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {ASK_AI_SCOPE_OPTIONS.filter(
                                  (option) => option.value !== scope
                                ).map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      handleRegenerateWithScope(option.value)
                                    }
                                    disabled={!lastUserMessage || isLoading}
                                    className="rounded-full bg-stone-100 px-3.5 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </section>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                  <Loader2 size={16} className="animate-spin" />
                  正在从 {currentScope.label} 里整理答案...
                </div>
              )}

              {errorMessage && (
                <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  出错了：{errorMessage}
                </div>
              )}
            </section>
          )}
        </div>

        <div
          className={cn(
            "z-10",
            messages.length > 0 ? "sticky bottom-0 pb-2 pt-6" : "mt-10 pb-8 pt-2"
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
                {ASK_AI_SCOPE_OPTIONS.map((option) => (
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
                  placeholder="使用 AI 处理各种任务..."
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
                    · Enter 发送，Shift+Enter 换行
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
                      清空对话
                    </button>
                  )}

                  {isLoading && (
                    <button
                      type="button"
                      onClick={() => stop()}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-3 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                      <Square size={14} />
                      停止
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
                    aria-label="发送消息"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </form>

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
