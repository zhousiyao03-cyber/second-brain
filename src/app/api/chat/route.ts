import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system:
      "你是 Second Brain 的 AI 助手，帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。",
    messages,
  });

  return result.toTextStreamResponse();
}
