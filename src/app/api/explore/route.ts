import { generateText, Output } from "ai";
import { db } from "@/server/db";
import { notes, bookmarks, todos } from "@/server/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod/v4";
import { getAIErrorMessage, getTaskModel } from "@/server/ai/openai";

const exploreOutputSchema = z.object({
  interests: z.array(z.string().min(1)).min(3).max(5),
  recommendations: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      category: z.string().min(1),
      reason: z.string().min(1),
    })
  ).length(5),
});

export async function POST() {
  // Gather user's recent data to understand interests
  const recentNotes = await db
    .select({ title: notes.title, tags: notes.tags })
    .from(notes)
    .orderBy(desc(notes.updatedAt))
    .limit(10);

  const recentBookmarks = await db
    .select({ title: bookmarks.title, url: bookmarks.url, tags: bookmarks.tags })
    .from(bookmarks)
    .orderBy(desc(bookmarks.createdAt))
    .limit(10);

  const recentTodos = await db
    .select({ title: todos.title, category: todos.category })
    .from(todos)
    .orderBy(desc(todos.createdAt))
    .limit(5);

  const context = {
    notes: recentNotes.map((n) => `${n.title}${n.tags ? ` [${n.tags}]` : ""}`).join("\n"),
    bookmarks: recentBookmarks.map((b) => `${b.title || b.url}${b.tags ? ` [${b.tags}]` : ""}`).join("\n"),
    todos: recentTodos.map((t) => `${t.title}${t.category ? ` (${t.category})` : ""}`).join("\n"),
  };

  try {
    const { output } = await generateText({
      model: getTaskModel(),
      output: Output.object({
        schema: exploreOutputSchema,
        name: "interest_recommendations",
        description: "Interest analysis with five personalized learning recommendations in Chinese.",
      }),
      prompt: `你是一个知识推荐助手。基于用户的笔记、收藏和待办，分析他们的兴趣方向并推荐5条相关的学习资源或话题。

用户最近的笔记：
${context.notes || "暂无"}

用户的收藏：
${context.bookmarks || "暂无"}

用户的待办：
${context.todos || "暂无"}

要求：
1. 推荐要基于用户实际数据推断的兴趣
2. 推荐内容要有学习价值
3. 如果用户数据不足，基于技术学习推荐通用资源
4. 返回中文结果，recommendations 固定 5 条`,
    });

    return Response.json(output);
  } catch (error) {
    return Response.json(
      { error: getAIErrorMessage(error, "OpenAI exploration failed") },
      { status: 500 }
    );
  }
}
