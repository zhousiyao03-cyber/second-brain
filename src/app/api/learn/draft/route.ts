import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData, getAIErrorMessage } from "@/server/ai/provider";
import { db } from "@/server/db";
import { learningNotes, learningTopics } from "@/server/db/schema";

const draftInputSchema = z.object({
  topicId: z.string(),
  keyword: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsedInput = draftInputSchema.safeParse(body);
  if (!parsedInput.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const { topicId, keyword } = parsedInput.data;

  const [topic] = await db
    .select()
    .from(learningTopics)
    .where(eq(learningTopics.id, topicId));

  if (!topic) {
    return Response.json({ error: "Topic not found" }, { status: 404 });
  }

  try {
    const output = await generateStructuredData({
      schema: z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        content: z.string().min(1),
      }),
      name: "learning_note_draft",
      description: "A detailed study note draft in Markdown.",
      prompt: `Create a detailed study note draft for topic "${topic.title}".

Focus keyword: ${keyword}
Topic description: ${topic.description ?? "None"}

Requirements:
- cover the important subtopics
- include practical examples
- write in clear Markdown
- keep the tone educational and concise`,
    });

    const id = crypto.randomUUID();
    await db.insert(learningNotes).values({
      id,
      topicId,
      userId: topic.userId,
      title: output.title,
      plainText: `${output.summary}\n\n${output.content}`,
      aiSummary: output.summary,
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: output.content }],
          },
        ],
      }),
    });

    await db
      .update(learningTopics)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(learningTopics.id, topicId), eq(learningTopics.userId, topic.userId))
      );

    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: getAIErrorMessage(error, "Draft generation failed") },
      { status: 500 }
    );
  }
}
