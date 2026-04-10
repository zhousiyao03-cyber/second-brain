"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-stone prose-sm dark:prose-invert max-w-none text-[15px] leading-7 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-blockquote:border-stone-300 prose-blockquote:dark:border-stone-600 prose-code:rounded prose-code:bg-stone-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-stone-800 prose-pre:bg-stone-900 prose-pre:dark:bg-stone-950 prose-pre:rounded-lg prose-pre:text-[13px] prose-hr:my-4 prose-table:text-sm prose-th:bg-stone-50 prose-th:dark:bg-stone-800 prose-strong:text-stone-900 prose-strong:dark:text-stone-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
