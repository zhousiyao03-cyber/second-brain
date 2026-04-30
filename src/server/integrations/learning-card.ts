import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { markdownToTiptap } from "../../lib/markdown-to-tiptap";
import { db } from "../db";
import { learningNotes, learningTopics } from "../db/schema";

export type CreateLearningCardInput = {
  userId: string;
  topicName: string;
  title: string;
  body: string;
  tags?: string[];
};

export type CreateLearningCardResult = {
  noteId: string;
  topicId: string;
  topicName: string;
  title: string;
};

export type CreateLearningCardDependencies = {
  randomUUID?: () => string;
  markdownToTiptap?: typeof markdownToTiptap;
  /** Test seam — defaults to the real db. */
  db?: typeof db;
};

/**
 * Create a learning card for the given user under a named topic. The topic is
 * created on first use; subsequent calls with the same name reuse it.
 *
 * The MCP `create_learning_card` tool delegates here so it stays in sync with
 * how interview-prep cards (currently produced by the bagu skill) get filed.
 */
export async function createLearningCard(
  input: CreateLearningCardInput,
  dependencies: CreateLearningCardDependencies = {}
): Promise<CreateLearningCardResult> {
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID;
  const markdownToTiptapImpl =
    dependencies.markdownToTiptap ?? markdownToTiptap;
  const dbImpl = dependencies.db ?? db;

  const topicName = input.topicName.trim();
  if (!topicName) {
    throw new Error("topicName is required");
  }
  const title = input.title.trim().slice(0, 160) || "Untitled";
  const body = input.body ?? "";

  // get-or-create topic by (userId, title=topicName)
  const existing = await dbImpl
    .select()
    .from(learningTopics)
    .where(
      and(
        eq(learningTopics.userId, input.userId),
        eq(learningTopics.title, topicName)
      )
    )
    .limit(1);

  let topicId: string;
  if (existing.length > 0) {
    topicId = existing[0]!.id;
  } else {
    topicId = randomUUID();
    await dbImpl.insert(learningTopics).values({
      id: topicId,
      userId: input.userId,
      title: topicName,
    });
  }

  const tiptapDoc = markdownToTiptapImpl(body);
  const content = JSON.stringify(tiptapDoc);
  const tagsJson = JSON.stringify(input.tags ?? []);

  const noteId = randomUUID();
  await dbImpl.insert(learningNotes).values({
    id: noteId,
    topicId,
    userId: input.userId,
    title,
    content,
    plainText: body,
    tags: tagsJson,
  });

  return { noteId, topicId, topicName, title };
}
