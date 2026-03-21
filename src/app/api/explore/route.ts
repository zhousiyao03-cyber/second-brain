import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { db } from "@/server/db";
import { notes, bookmarks, todos } from "@/server/db/schema";
import { desc } from "drizzle-orm";

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
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt: `你是一个知识推荐助手。基于用户的笔记、收藏和待办，分析他们的兴趣方向并推荐5条相关的学习资源或话题。

用户最近的笔记：
${context.notes || "暂无"}

用户的收藏：
${context.bookmarks || "暂无"}

用户的待办：
${context.todos || "暂无"}

请以 JSON 格式回复：
{
  "interests": ["兴趣1", "兴趣2", "兴趣3"],
  "recommendations": [
    {
      "title": "推荐标题",
      "description": "简要描述（30字以内）",
      "category": "分类",
      "reason": "推荐理由（20字以内）"
    }
  ]
}

要求：
1. 推荐要基于用户实际数据推断的兴趣
2. 推荐内容要有学习价值
3. 如果用户数据不足，基于技术学习推荐通用资源`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: "Failed to parse" }, { status: 500 });
    }

    return Response.json(JSON.parse(jsonMatch[0]));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI exploration failed" },
      { status: 500 }
    );
  }
}
