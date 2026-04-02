import crypto from "crypto";
import { and, desc, eq, like } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData } from "../ai/provider";
import { db } from "../db";
import {
  learningNotes,
  learningReviews,
  learningTopics,
} from "../db/schema";
import { protectedProcedure, router } from "../trpc";

const createTopicSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  icon: z.string().trim().max(8).optional(),
});

const updateTopicSchema = createTopicSchema.extend({
  id: z.string(),
});

const noteInputSchema = z.object({
  topicId: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  plainText: z.string().optional(),
  tags: z.string().optional(),
  aiSummary: z.string().optional(),
});

const updateNoteSchema = noteInputSchema.extend({
  id: z.string(),
});

const reviewTypeSchema = z.enum(["outline", "gap", "quiz"]);

function parseTags(tags: string | null | undefined) {
  if (!tags) return [] as string[];

  try {
    const value = JSON.parse(tags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function summarizePreview(text: string | null | undefined, fallback: string) {
  const trimmed = text?.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

async function collectTopicMeta(topicId: string) {
  const notes = await db
    .select({
      id: learningNotes.id,
      title: learningNotes.title,
      plainText: learningNotes.plainText,
      tags: learningNotes.tags,
    })
    .from(learningNotes)
    .where(eq(learningNotes.topicId, topicId));

  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of parseTags(note.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    noteCount: notes.length,
    topTags,
    combinedText: notes
      .map((note) => note.plainText?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
  };
}

export const learningNotebookRouter = router({
  listTopics: protectedProcedure.query(async ({ ctx }) => {
    const topics = await db
      .select()
      .from(learningTopics)
      .where(eq(learningTopics.userId, ctx.userId))
      .orderBy(desc(learningTopics.updatedAt));

    return Promise.all(
      topics.map(async (topic) => ({
        ...topic,
        ...(await collectTopicMeta(topic.id)),
      }))
    );
  }),

  getTopic: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [topic] = await db
        .select()
        .from(learningTopics)
        .where(
          and(
            eq(learningTopics.id, input.id),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      if (!topic) return null;

      return { ...topic, ...(await collectTopicMeta(topic.id)) };
    }),

  createTopic: protectedProcedure
    .input(createTopicSchema)
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(learningTopics).values({
        id,
        userId: ctx.userId,
        title: input.title,
        description: input.description,
        icon: input.icon,
      });
      return { id };
    }),

  updateTopic: protectedProcedure
    .input(updateTopicSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db
        .update(learningTopics)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(eq(learningTopics.id, id), eq(learningTopics.userId, ctx.userId))
        );
      return { id };
    }),

  deleteTopic: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(learningTopics)
        .where(
          and(
            eq(learningTopics.id, input.id),
            eq(learningTopics.userId, ctx.userId)
          )
        );
      return { success: true };
    }),

  listNotes: protectedProcedure
    .input(
      z.object({
        topicId: z.string(),
        search: z.string().trim().optional(),
        tag: z.string().trim().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const clauses = [
        eq(learningNotes.topicId, input.topicId),
        eq(learningNotes.userId, ctx.userId),
      ];

      if (input.search) {
        clauses.push(
          like(learningNotes.plainText, `%${input.search}%`) as ReturnType<
            typeof eq
          >
        );
      }

      const notes = await db
        .select()
        .from(learningNotes)
        .where(and(...clauses))
        .orderBy(desc(learningNotes.updatedAt));

      return notes.filter((note) =>
        input.tag ? parseTags(note.tags).includes(input.tag) : true
      );
    }),

  getNote: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [note] = await db
        .select()
        .from(learningNotes)
        .where(
          and(eq(learningNotes.id, input.id), eq(learningNotes.userId, ctx.userId))
        );
      return note ?? null;
    }),

  createNote: protectedProcedure
    .input(noteInputSchema)
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(learningNotes).values({
        id,
        topicId: input.topicId,
        userId: ctx.userId,
        title: input.title?.trim() || "",
        content: input.content,
        plainText: input.plainText,
        tags: input.tags,
        aiSummary: input.aiSummary,
      });

      await db
        .update(learningTopics)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(learningTopics.id, input.topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      return { id };
    }),

  updateNote: protectedProcedure
    .input(updateNoteSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, topicId, ...data } = input;
      await db
        .update(learningNotes)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(eq(learningNotes.id, id), eq(learningNotes.userId, ctx.userId))
        );

      await db
        .update(learningTopics)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(learningTopics.id, topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      return { id };
    }),

  deleteNote: protectedProcedure
    .input(z.object({ id: z.string(), topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(learningNotes)
        .where(
          and(eq(learningNotes.id, input.id), eq(learningNotes.userId, ctx.userId))
        );

      await db
        .update(learningTopics)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(learningTopics.id, input.topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      return { success: true };
    }),

  listReviews: protectedProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      return db
        .select()
        .from(learningReviews)
        .where(
          and(
            eq(learningReviews.topicId, input.topicId),
            eq(learningReviews.userId, ctx.userId)
          )
        )
        .orderBy(desc(learningReviews.createdAt));
    }),

  generateReview: protectedProcedure
    .input(
      z.object({
        topicId: z.string(),
        type: reviewTypeSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [topic] = await db
        .select()
        .from(learningTopics)
        .where(
          and(
            eq(learningTopics.id, input.topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      if (!topic) {
        throw new Error("Topic not found");
      }

      const { combinedText } = await collectTopicMeta(topic.id);
      const sourceText = combinedText || "No notes yet.";

      const output = await generateStructuredData({
        schema: z.object({
          title: z.string().min(1),
          summary: z.string().min(1),
          items: z.array(
            z.object({
              heading: z.string().min(1),
              detail: z.string().min(1),
            })
          ),
        }),
        name: `learning_${input.type}_review`,
        description: "A structured study review in English.",
        prompt: `You are helping a developer review their study notes for "${topic.title}".

Review type: ${input.type}
Topic description: ${topic.description ?? "None"}
Notes:
${sourceText}

Return concise but useful sections.
- outline: extract the current knowledge map
- gap: identify missing but important areas
- quiz: produce question-style prompts in the items list`,
      });

      const id = crypto.randomUUID();
      await db.insert(learningReviews).values({
        id,
        topicId: topic.id,
        userId: ctx.userId,
        type: input.type,
        content: JSON.stringify(output),
      });

      return { id, content: output };
    }),

  ask: protectedProcedure
    .input(
      z.object({
        topicId: z.string(),
        question: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [topic] = await db
        .select()
        .from(learningTopics)
        .where(
          and(
            eq(learningTopics.id, input.topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      if (!topic) {
        throw new Error("Topic not found");
      }

      const { combinedText } = await collectTopicMeta(topic.id);
      const answer = await generateStructuredData({
        schema: z.object({ answer: z.string().min(1) }),
        name: "learning_topic_answer",
        description: "An answer grounded in the user's study notes.",
        prompt: `Answer the question using the study notes when possible.

Topic: ${topic.title}
Question: ${input.question}
Notes:
${combinedText || "No notes yet."}

If the notes are incomplete, say so clearly and provide the best answer you can.`,
      });

      return answer;
    }),

  getTopicSnapshot: protectedProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [topic] = await db
        .select()
        .from(learningTopics)
        .where(
          and(
            eq(learningTopics.id, input.topicId),
            eq(learningTopics.userId, ctx.userId)
          )
        );

      if (!topic) return null;

      const notes = await db
        .select({
          title: learningNotes.title,
          plainText: learningNotes.plainText,
          aiSummary: learningNotes.aiSummary,
        })
        .from(learningNotes)
        .where(eq(learningNotes.topicId, input.topicId))
        .orderBy(desc(learningNotes.updatedAt));

      return {
        topic,
        notes: notes.map((note) => ({
          title: note.title,
          preview: summarizePreview(note.aiSummary ?? note.plainText, "Empty note"),
          plainText: note.plainText ?? "",
        })),
      };
    }),
});
