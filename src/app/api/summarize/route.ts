import { z } from "zod/v4";
import { db } from "@/server/db";
import { bookmarks } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { generateStructuredData, getAIErrorMessage } from "@/server/ai/provider";
import { auth } from "@/lib/auth";

const summarizeInputSchema = z.object({
  bookmarkId: z.string(),
});

const summaryOutputSchema = z.object({
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).min(2).max(3),
});

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 3);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = summarizeInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const { bookmarkId } = parsed.data;

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
    const output = await generateStructuredData(
      {
        schema: summaryOutputSchema,
        name: "bookmark_summary",
        description: "A concise Chinese bookmark summary with 2-3 short tags.",
        prompt: `请对以下内容生成简短的中文摘要（不超过100字），并推荐2-3个标签（JSON数组格式）。

内容：${contentToSummarize}

请输出中文结果：
1. summary 控制在 100 字以内。
2. tags 提供 2-3 个简短标签，不要重复。`,
      },
      { userId: session.user.id },
    );

    const tags = normalizeTags(output.tags);
    const summary = output.summary.trim();

    await db
      .update(bookmarks)
      .set({
        summary,
        tags: JSON.stringify(tags),
        status: "processed",
        updatedAt: new Date(),
      })
      .where(eq(bookmarks.id, bookmarkId));

    return Response.json({ success: true, summary, tags });
  } catch (error) {
    await db
      .update(bookmarks)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(bookmarks.id, bookmarkId));

    return Response.json(
      { error: getAIErrorMessage(error, "AI summarization failed") },
      { status: 500 }
    );
  }
}
