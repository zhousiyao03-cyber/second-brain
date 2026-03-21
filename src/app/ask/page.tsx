"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const transport = new TextStreamChatTransport({ api: "/api/chat" });

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

  return (
    <div className="flex flex-col h-full max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Ask AI</h1>

      <div className="flex-1 overflow-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Bot size={48} className="mx-auto mb-3 opacity-50" />
            <p>向 AI 提问，基于你的知识库获取回答</p>
            <p className="text-sm mt-2">试试问：&quot;帮我总结一下最近的笔记&quot;</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-3 p-4 rounded-lg",
              message.role === "user" ? "bg-blue-50" : "bg-gray-50"
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
              {message.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null
              )}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3 p-4 rounded-lg bg-gray-50">
            <Bot size={18} className="text-gray-600 flex-shrink-0 mt-0.5" />
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
            出错了：{error.message}。请检查 ANTHROPIC_API_KEY 是否已配置。
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-gray-200 pt-4"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的问题..."
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
