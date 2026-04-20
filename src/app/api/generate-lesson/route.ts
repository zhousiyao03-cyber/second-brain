import { db } from "@/server/db";
import { learningPaths, learningLessons } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData, getAIErrorMessage } from "@/server/ai/provider";
import { auth } from "@/lib/auth";

const generateLessonInputSchema = z.object({
  pathId: z.string(),
});

const lessonOutputSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  quiz: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    })
  ).min(2).max(4),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsedInput = generateLessonInputSchema.safeParse(body);
  if (!parsedInput.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const { pathId } = parsedInput.data;

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
    const output = await generateStructuredData(
      {
        schema: lessonOutputSchema,
        name: "learning_lesson",
        description:
          "A Chinese programming lesson with markdown content and quiz answers.",
        prompt: `你是一位编程导师。请为学习路径"${path.title}"生成下一节课程。

学习路径描述：${path.description}
已有课程：${existingTitles || "无（这是第一节课）"}

要求：
1. 内容循序渐进，基于已有课程深入
2. 包含实际代码示例
3. 练习题要有实际编程思考价值
4. content 使用 Markdown，控制在 800-1200 字`,
      },
      { userId: session.user.id },
    );
    const lessonId = crypto.randomUUID();

    await db.insert(learningLessons).values({
      id: lessonId,
      pathId,
      title: output.title.trim(),
      content: output.content.trim(),
      quiz: JSON.stringify(output.quiz),
      orderIndex: existingLessons.length,
      status: "available",
    });

    return Response.json({ success: true, lessonId, title: output.title.trim() });
  } catch (error) {
    return Response.json(
      { error: getAIErrorMessage(error, "AI lesson generation failed") },
      { status: 500 }
    );
  }
}
