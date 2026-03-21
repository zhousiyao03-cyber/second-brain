import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { db } from "@/server/db";
import { bookmarks } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const { bookmarkId } = await req.json();

  // Get the bookmark
  const [bookmark] = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.id, bookmarkId));

  if (!bookmark) {
    return Response.json({ error: "Bookmark not found" }, { status: 404 });
  }

  const contentToSummarize = bookmark.content || bookmark.url || bookmark.title;
  if (!contentToSummarize) {
    return Response.json({ error: "No content to summarize" }, { status: 400 });
  }

  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt: `请对以下内容生成简短的中文摘要（不超过100字），并推荐2-3个标签（JSON数组格式）。

内容：${contentToSummarize}

请以JSON格式回复：
{"summary": "摘要内容", "tags": ["标签1", "标签2"]}`,
    });

    // Parse AI response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      await db
        .update(bookmarks)
        .set({
          summary: parsed.summary,
          tags: JSON.stringify(parsed.tags),
          status: "processed",
          updatedAt: new Date(),
        })
        .where(eq(bookmarks.id, bookmarkId));

      return Response.json({ success: true, summary: parsed.summary, tags: parsed.tags });
    }

    return Response.json({ error: "Failed to parse AI response" }, { status: 500 });
  } catch (error) {
    await db
      .update(bookmarks)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(bookmarks.id, bookmarkId));

    return Response.json(
      { error: error instanceof Error ? error.message : "AI summarization failed" },
      { status: 500 }
    );
  }
}
