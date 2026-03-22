import {
  convertToModelMessages,
  modelMessageSchema,
  streamText,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod/v4";
import { retrieveContext } from "@/server/ai/rag";
import { getAIErrorMessage, getChatModel } from "@/server/ai/openai";

export const maxDuration = 30;

const chatInputSchema = z.object({
  messages: z.array(z.unknown()),
});

const uiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.object({ type: z.string() }).passthrough()),
  })
  .passthrough();

const SKIP_RAG_KEYWORDS = ["不用搜索", "直接回答", "不需要搜索", "不要搜索"];

function buildSystemPrompt(
  context: Awaited<ReturnType<typeof retrieveContext>>
): string {
  if (context.length === 0) {
    return "你是 Second Brain 的 AI 助手。用户的知识库中没有找到相关内容，请直接用中文回答问户的问题，简洁准确。";
  }

  const knowledgeBlock = context
    .map(
      (item) =>
        `<source id="${item.id}" type="${item.type}" title="${item.title}">\n${item.content}\n</source>`
    )
    .join("\n\n");

  return `你是 Second Brain 的 AI 助手，帮助用户管理和理解他们的知识库。用中文回答问题，简洁准确。

以下是从用户知识库中检索到的相关内容，请优先基于这些内容回答用户的问题：

<knowledge_base>
${knowledgeBlock}
</knowledge_base>

回答规则：
1. 优先基于知识库中的内容回答，如果知识库内容不足以回答，可以补充你自己的知识，但要说明哪些是来自知识库、哪些是补充。
2. 如果你使用了知识库中的内容，必须在回复的最末尾追加一个隐藏标记，格式为：
<!-- sources:[{"id":"来源ID","type":"note或bookmark","title":"来源标题"}] -->
只包含你实际引用的来源，不要包含未使用的来源。
3. 隐藏标记必须是回复的最后一行，前面有一个空行。`;
}

async function normalizeMessages(messages: unknown[]): Promise<ModelMessage[]> {
  const uiMessages = z.array(uiMessageSchema).safeParse(messages);
  if (uiMessages.success) {
    return convertToModelMessages(
      uiMessages.data as Array<Omit<UIMessage, "id">>
    );
  }

  const modelMessages = z.array(modelMessageSchema).safeParse(messages);
  if (modelMessages.success) {
    return modelMessages.data;
  }

  throw new Error(
    "Invalid chat message format. Expected AI SDK UI messages or model messages."
  );
}

function getUserMessageText(message: ModelMessage | undefined) {
  if (!message || message.role !== "user") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const messages = await normalizeMessages(parsed.data.messages);

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const userQuery = getUserMessageText(lastUserMessage);

    const skipRag = SKIP_RAG_KEYWORDS.some((kw) => userQuery.includes(kw));
    const context = skipRag ? [] : await retrieveContext(userQuery);

    const result = streamText({
      model: getChatModel(),
      system: buildSystemPrompt(context),
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    const isInvalidInput =
      error instanceof Error &&
      error.message.includes("Invalid chat message format");

    return Response.json(
      {
        error: getAIErrorMessage(
          error,
          isInvalidInput ? "Invalid input" : "AI chat request failed"
        ),
      },
      { status: isInvalidInput ? 400 : 500 }
    );
  }
}
