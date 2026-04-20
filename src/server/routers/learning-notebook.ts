import crypto from "crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
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
  icon: z.string().trim().optional(),
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
    // Single query: fetch topics + note counts + tags in one pass (no N+1)
    const topics = await db
      .select()
      .from(learningTopics)
      .where(eq(learningTopics.userId, ctx.userId))
      .orderBy(desc(learningTopics.updatedAt));

    if (topics.length === 0) return [];

    // Batch: get note count + tags for ALL topics in one query
    const topicIds = topics.map((t) => t.id);
    const noteMeta = await db
      .select({
        topicId: learningNotes.topicId,
        noteCount: sql<number>`count(*)`.as("note_count"),
        allTags: sql<string>`group_concat(${learningNotes.tags})`.as("all_tags"),
      })
      .from(learningNotes)
      .where(
        and(
          sql`${learningNotes.topicId} IN (${sql.join(topicIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(learningNotes.userId, ctx.userId)
        )
      )
      .groupBy(learningNotes.topicId);

    const metaMap = new Map(noteMeta.map((m) => [m.topicId, m]));

    return topics.map((topic) => {
      const meta = metaMap.get(topic.id);
      const noteCount = meta?.noteCount ?? 0;

      // Parse concatenated tags to get top 5
      const tagCounts = new Map<string, number>();
      if (meta?.allTags) {
        for (const chunk of meta.allTags.split(",")) {
          for (const tag of parseTags(chunk)) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }
      const topTags = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag]) => tag);

      return { ...topic, noteCount, topTags, combinedText: "" };
    });
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
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).default(0),
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

      let items = await db
        .select()
        .from(learningNotes)
        .where(and(...clauses))
        .orderBy(desc(learningNotes.updatedAt))
        .limit(input.limit + 1)
        .offset(input.offset);

      // Tag filtering still needs to happen post-query (JSON column)
      if (input.tag) {
        items = items.filter((note) => parseTags(note.tags).includes(input.tag!));
      }

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return { items, hasMore, offset: input.offset };
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
      await db.transaction(async (tx) => {
        await tx.insert(learningNotes).values({
          id,
          topicId: input.topicId,
          userId: ctx.userId,
          title: input.title?.trim() || "",
          content: input.content,
          plainText: input.plainText,
          tags: input.tags,
          aiSummary: input.aiSummary,
        });

        await tx
          .update(learningTopics)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(learningTopics.id, input.topicId),
              eq(learningTopics.userId, ctx.userId)
            )
          );
      });

      return { id };
    }),

  updateNote: protectedProcedure
    .input(updateNoteSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, topicId, ...data } = input;
      await db.transaction(async (tx) => {
        await tx
          .update(learningNotes)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(eq(learningNotes.id, id), eq(learningNotes.userId, ctx.userId))
          );

        await tx
          .update(learningTopics)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(learningTopics.id, topicId),
              eq(learningTopics.userId, ctx.userId)
            )
          );
      });

      return { id };
    }),

  deleteNote: protectedProcedure
    .input(z.object({ id: z.string(), topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(learningNotes)
          .where(
            and(eq(learningNotes.id, input.id), eq(learningNotes.userId, ctx.userId))
          );

        await tx
          .update(learningTopics)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(learningTopics.id, input.topicId),
              eq(learningTopics.userId, ctx.userId)
            )
          );
      });

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

      const output = await generateStructuredData(
        {
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
        },
        { userId: ctx.userId },
      );

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
      const answer = await generateStructuredData(
        {
          schema: z.object({ answer: z.string().min(1) }),
          name: "learning_topic_answer",
          description: "An answer grounded in the user's study notes.",
          prompt: `Answer the question using the study notes when possible.

Topic: ${topic.title}
Question: ${input.question}
Notes:
${combinedText || "No notes yet."}

If the notes are incomplete, say so clearly and provide the best answer you can.`,
        },
        { userId: ctx.userId },
      );

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
