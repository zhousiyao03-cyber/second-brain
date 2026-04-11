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
import { enqueueJob } from "../jobs/queue";

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
  trackJob = true,
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
  /**
   * 是否由 syncSourceIndex 内部创建一条 knowledgeIndexJobs 记录。
   * - true（默认）：旧路径 / seed 路径使用，保持之前的行为
   * - false：worker 路径使用 —— 此时外层已经在管 job 生命周期了，
   *   内部不应再写一条新的
   */
  trackJob?: boolean;
}) {
  const jobId = trackJob ? await startIndexJob(sourceType, sourceId, reason) : null;

  try {
    const nextChunks = chunkKnowledgeSource({
      content,
      plainText,
      sourceType,
      summary,
    });

    if (nextChunks.length === 0) {
      await deleteChunkRows(sourceType, sourceId);
      if (jobId) await finishIndexJob(jobId, "done");
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
      if (jobId) await finishIndexJob(jobId, "done");
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

    if (jobId) await finishIndexJob(jobId, "done");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    if (jobId) await finishIndexJob(jobId, "failed", message);
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

/**
 * 异步入队版本：只创建一条 pending job，立即返回。
 * 真正的索引工作由 worker 拾取后执行（见 `src/server/jobs/worker.ts`）。
 *
 * 和旧的 syncNoteKnowledgeIndex 的区别：
 *   - 旧版：fire-and-forget，失败就丢了
 *   - 新版：失败会自动重试（指数退避），超限才进 failed 终态
 *
 * router 里的写路径应该用这个，而不是直接 sync*Index。
 */
/**
 * tx 参数可选：调用方在 db.transaction 内想让入队与业务写原子一致时，
 * 把事务句柄传进来即可（outbox 雏形）。不传就走模块级 db，行为和之前一样。
 */
export async function enqueueNoteIndexJob(
  noteId: string,
  reason: string,
  tx?: Parameters<typeof enqueueJob>[1]
) {
  return enqueueJob({ sourceType: "note", sourceId: noteId, reason }, tx);
}

export async function enqueueBookmarkIndexJob(
  bookmarkId: string,
  reason: string,
  tx?: Parameters<typeof enqueueJob>[1]
) {
  return enqueueJob({ sourceType: "bookmark", sourceId: bookmarkId, reason }, tx);
}

/**
 * Worker 调用的入口：根据 sourceType + sourceId 重新读一次最新数据，
 * 然后跑 syncSourceIndex（含内部的 job 生命周期追踪）。
 *
 * 注意：这里读"最新数据"而不是把 payload 塞到 job 表里，因为 worker 延迟
 * 执行期间数据可能又被用户改过，最终写入的应该是最新版本。
 */
export async function runIndexJobFor(
  sourceType: KnowledgeSourceType,
  sourceId: string,
  reason: string
) {
  if (sourceType === "note") {
    const [note] = await db.select().from(notes).where(eq(notes.id, sourceId));
    if (!note) {
      // note 已被删除 — 把索引清掉即可
      await deleteChunkRows("note", sourceId);
      return;
    }
    await syncSourceIndex({
      content: note.content,
      plainText: note.plainText,
      reason,
      sourceId: note.id,
      sourceTitle: note.title,
      sourceType: "note",
      sourceUpdatedAt: note.updatedAt,
      userId: note.userId,
      trackJob: false, // 外层 worker 已经管着 job 生命周期
    });
    return;
  }

  if (sourceType === "bookmark") {
    const [bookmark] = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, sourceId));
    if (!bookmark) {
      await deleteChunkRows("bookmark", sourceId);
      return;
    }
    await syncSourceIndex({
      content: bookmark.content ?? bookmark.title ?? bookmark.url,
      reason,
      sourceId: bookmark.id,
      sourceTitle: bookmark.title ?? bookmark.url ?? "无标题",
      sourceType: "bookmark",
      sourceUpdatedAt: bookmark.updatedAt,
      summary: bookmark.summary,
      userId: bookmark.userId,
      trackJob: false,
    });
    return;
  }
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
