"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { Send, Bot, User, Loader2, FileText, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

interface Source {
  id: string;
  type: "note" | "bookmark";
  title: string;
}

const SOURCES_REGEX = /\n?\s*<!--\s*sources:\s*(\[[\s\S]*?\])\s*-->\s*$/;

function parseSourcesFromText(text: string): {
  cleanText: string;
  sources: Source[];
} {
  const match = text.match(SOURCES_REGEX);
  if (!match) return { cleanText: text, sources: [] };

  try {
    const sources = JSON.parse(match[1]) as Source[];
    const cleanText = text.replace(SOURCES_REGEX, "").trimEnd();
    return { cleanText, sources };
  } catch {
    return { cleanText: text, sources: [] };
  }
}

function getMessageText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export default function AskPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Ask AI</h1>

      <div className="flex-1 overflow-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Bot size={48} className="mx-auto mb-3 opacity-50" />
            <p>向 AI 提问，基于你的知识库获取回答</p>
            <p className="text-sm mt-2">
              试试问：&quot;帮我总结一下最近的笔记&quot;
            </p>
          </div>
        )}

        {messages.map((message) => {
          const rawText = getMessageText(message.parts);
          const isAssistant = message.role === "assistant";
          const { cleanText, sources } = isAssistant
            ? parseSourcesFromText(rawText)
            : { cleanText: rawText, sources: [] };

          return (
            <div key={message.id}>
              <div
                className={cn(
                  "flex gap-3 p-4 rounded-lg",
                  message.role === "user" ? "bg-blue-50 dark:bg-blue-900/20" : "bg-gray-50 dark:bg-gray-800"
                )}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {message.role === "user" ? (
                    <User size={18} className="text-blue-600" />
                  ) : (
                    <Bot size={18} className="text-gray-600" />
                  )}
                </div>
                <div className="flex-1 text-sm leading-relaxed whitespace-pre-wrap">
                  {cleanText}
                </div>
              </div>
              {sources.length > 0 && (
                <div className="ml-9 mt-2 flex flex-wrap gap-2">
                  {sources.map((source) => (
                    <a
                      key={source.id}
                      href={
                        source.type === "note"
                          ? `/notes/${source.id}`
                          : "/bookmarks"
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      {source.type === "note" ? (
                        <FileText size={12} />
                      ) : (
                        <Bookmark size={12} />
                      )}
                      {source.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <Bot size={18} className="text-gray-600 flex-shrink-0 mt-0.5" />
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
            出错了：{error.message}。请检查本地模型服务是否启动，或 AI provider 配置是否正确。
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-gray-200 dark:border-gray-700 pt-4"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题...（Shift+Enter 换行）"
          rows={2}
          className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
