import crypto from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  bookmarks,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeIndexJobs,
  notes,
} from "../db/schema";
import { chunkKnowledgeSource, type KnowledgeSourceType } from "./chunking";
import {
  embedTexts,
  vectorArrayToBuffer,
} from "./embeddings";

type ExistingChunkRow = typeof knowledgeChunks.$inferSelect;

let seedPromise: Promise<void> | null = null;

function createJobId() {
  return crypto.randomUUID();
}

function serializeSectionPath(sectionPath: string[]) {
  return JSON.stringify(sectionPath);
}

function sameChunkFingerprints(
  existing: ExistingChunkRow[],
  next: ReturnType<typeof chunkKnowledgeSource>
) {
  if (existing.length !== next.length) {
    return false;
  }

  return existing.every((chunk, index) => {
    const candidate = next[index];
    return (
      candidate != null &&
      chunk.textHash === candidate.textHash &&
      (chunk.blockType ?? "") === candidate.blockType &&
      (chunk.sectionPath ?? "[]") === serializeSectionPath(candidate.sectionPath)
    );
  });
}

async function startIndexJob(
  sourceType: KnowledgeSourceType,
  sourceId: string,
  reason: string
) {
  const id = createJobId();

  await db.insert(knowledgeIndexJobs).values({
    id,
    reason,
    sourceId,
    sourceType,
    status: "running",
  });

  return id;
}

async function finishIndexJob(id: string, status: "done" | "failed", error?: string) {
  await db
    .update(knowledgeIndexJobs)
    .set({
      status,
      error,
      finishedAt: new Date(),
    })
    .where(eq(knowledgeIndexJobs.id, id));
}

async function deleteChunkRows(sourceType: KnowledgeSourceType, sourceId: string) {
  const existingChunkRows = await db
    .select({ id: knowledgeChunks.id })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId)
      )
    );

  const chunkIds = existingChunkRows.map((row) => row.id);

  if (chunkIds.length > 0) {
    await db
      .delete(knowledgeChunkEmbeddings)
      .where(inArray(knowledgeChunkEmbeddings.chunkId, chunkIds));
  }

  await db
    .delete(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId)
      )
    );
}

async function syncSourceIndex({
  content,
  plainText,
  reason,
  sourceId,
  sourceTitle,
  sourceType,
  sourceUpdatedAt,
  summary,
  userId,
}: {
  content?: string | null;
  plainText?: string | null;
  reason: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: KnowledgeSourceType;
  sourceUpdatedAt?: Date | null;
  summary?: string | null;
  userId: string;
}) {
  const jobId = await startIndexJob(sourceType, sourceId, reason);

  try {
    const nextChunks = chunkKnowledgeSource({
      content,
      plainText,
      sourceType,
      summary,
    });

    if (nextChunks.length === 0) {
      await deleteChunkRows(sourceType, sourceId);
      await finishIndexJob(jobId, "done");
      return;
    }

    const existing = await db
      .select()
      .from(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.sourceType, sourceType),
          eq(knowledgeChunks.sourceId, sourceId)
        )
      )
      .orderBy(knowledgeChunks.chunkIndex);

    if (sameChunkFingerprints(existing, nextChunks)) {
      await db
        .update(knowledgeChunks)
        .set({
          sourceTitle,
          sourceUpdatedAt: sourceUpdatedAt ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeChunks.sourceType, sourceType),
            eq(knowledgeChunks.sourceId, sourceId)
          )
        );
      await finishIndexJob(jobId, "done");
      return;
    }

    await deleteChunkRows(sourceType, sourceId);

    const insertedChunks = nextChunks.map((chunk) => ({
      id: crypto.randomUUID(),
      userId,
      sourceType,
      sourceId,
      sourceTitle,
      sourceUpdatedAt: sourceUpdatedAt ?? null,
      chunkIndex: chunk.chunkIndex,
      sectionPath: serializeSectionPath(chunk.sectionPath),
      blockType: chunk.blockType,
      text: chunk.text,
      textHash: chunk.textHash,
      tokenCount: chunk.tokenCount,
    }));

    await db.insert(knowledgeChunks).values(insertedChunks);

    const embedded = await embedTexts(nextChunks.map((chunk) => chunk.text)).catch(
      () => null
    );

    if (embedded) {
      await db.insert(knowledgeChunkEmbeddings).values(
        embedded.vectors.map((vector, index) => ({
          chunkId: insertedChunks[index]!.id,
          model: embedded.model,
          dims: vector.length,
          vector: vectorArrayToBuffer(vector),
        }))
      );
    }

    await finishIndexJob(jobId, "done");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    await finishIndexJob(jobId, "failed", message);
    throw error;
  }
}

export async function syncNoteKnowledgeIndex(
  note: typeof notes.$inferSelect,
  reason = "note-update"
) {
  return syncSourceIndex({
    content: note.content,
    plainText: note.plainText,
    reason,
    sourceId: note.id,
    sourceTitle: note.title,
    sourceType: "note",
    sourceUpdatedAt: note.updatedAt,
    userId: note.userId,
  });
}

export async function syncBookmarkKnowledgeIndex(
  bookmark: typeof bookmarks.$inferSelect,
  reason = "bookmark-update"
) {
  return syncSourceIndex({
    content: bookmark.content ?? bookmark.title ?? bookmark.url,
    reason,
    sourceId: bookmark.id,
    sourceTitle: bookmark.title ?? bookmark.url ?? "无标题",
    sourceType: "bookmark",
    sourceUpdatedAt: bookmark.updatedAt,
    summary: bookmark.summary,
    userId: bookmark.userId,
  });
}

export async function removeKnowledgeSourceIndex(
  sourceType: KnowledgeSourceType,
  sourceId: string
) {
  await deleteChunkRows(sourceType, sourceId);
}

export async function ensureKnowledgeBaseSeeded() {
  const [{ count: chunkCount }] = await db
    .select({ count: count() })
    .from(knowledgeChunks);

  if (chunkCount > 0) {
    return;
  }

  const [{ count: noteCount }] = await db.select({ count: count() }).from(notes);
  const [{ count: bookmarkCount }] = await db
    .select({ count: count() })
    .from(bookmarks);

  if (noteCount + bookmarkCount === 0) {
    return;
  }

  if (!seedPromise) {
    seedPromise = (async () => {
      const allNotes = await db.select().from(notes);
      for (const note of allNotes) {
        await syncNoteKnowledgeIndex(note, "initial-seed");
      }

      const allBookmarks = await db.select().from(bookmarks);
      for (const bookmark of allBookmarks) {
        await syncBookmarkKnowledgeIndex(bookmark, "initial-seed");
      }
    })().finally(() => {
      seedPromise = null;
    });
  }

  await seedPromise;
}
