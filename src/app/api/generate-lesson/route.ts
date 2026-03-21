import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { db } from "@/server/db";
import { learningPaths, learningLessons } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const { pathId } = await req.json();

  const [path] = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.id, pathId));

  if (!path) {
    return Response.json({ error: "Path not found" }, { status: 404 });
  }

  const existingLessons = await db
    .select()
    .from(learningLessons)
    .where(eq(learningLessons.pathId, pathId));

  const existingTitles = existingLessons.map((l) => l.title).join("、");

  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt: `你是一位编程导师。请为学习路径"${path.title}"生成下一节课程。

学习路径描述：${path.description}
已有课程：${existingTitles || "无（这是第一节课）"}

请生成一节新课程，以 JSON 格式回复：
{
  "title": "课程标题",
  "content": "详细的课程内容（Markdown 格式，包含代码示例，800-1200字）",
  "quiz": [
    {"question": "练习题1", "answer": "答案1"},
    {"question": "练习题2", "answer": "答案2"}
  ]
}

要求：
1. 内容循序渐进，基于已有课程深入
2. 包含实际代码示例
3. 练习题要有实际编程思考价值`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const lessonId = crypto.randomUUID();

    await db.insert(learningLessons).values({
      id: lessonId,
      pathId,
      title: parsed.title,
      content: parsed.content,
      quiz: JSON.stringify(parsed.quiz),
      orderIndex: existingLessons.length,
      status: "available",
    });

    return Response.json({ success: true, lessonId, title: parsed.title });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI generation failed" },
      { status: 500 }
    );
  }
}
