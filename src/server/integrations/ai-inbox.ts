import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { folders } from "../db/schema";

export const AI_INBOX_FOLDER_NAME = "AI Inbox";

export type AiInboxFolderRepository = {
  findInboxFolder(userId: string): Promise<{ id: string } | null>;
  findFolderByName(userId: string, name: string): Promise<{ id: string } | null>;
  findNextRootSortOrder(userId: string): Promise<number>;
  createInboxFolder(input: {
    id: string;
    userId: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<void>;
  createFolder(input: {
    id: string;
    userId: string;
    name: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<void>;
};

type AiInboxDbRunner = {
  select: (...args: unknown[]) => {
    from: (table: unknown) => {
      where: (clause: unknown) => Promise<Array<Record<string, unknown>>> & {
        limit: (count: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert: (...args: unknown[]) => {
    values: (value: unknown) => Promise<unknown>;
  };
};

export function createAiInboxFolderRepository(
  runner: AiInboxDbRunner
): AiInboxFolderRepository {
  return {
    async findInboxFolder(userId: string) {
      const [existing] = (await runner
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.userId, userId),
            eq(folders.name, AI_INBOX_FOLDER_NAME),
            sql`${folders.parentId} is null`
          )
        )
        .limit(1)) as Array<{ id: string }>;

      return existing ? { id: existing.id } : null;
    },

    async findFolderByName(userId: string, name: string) {
      const [existing] = (await runner
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.userId, userId),
            eq(folders.name, name),
            sql`${folders.parentId} is null`
          )
        )
        .limit(1)) as Array<{ id: string }>;

      return existing ? { id: existing.id } : null;
    },

    async findNextRootSortOrder(userId: string) {
      const [row] = (await runner
        .select({
          max: sql<number>`coalesce(max(${folders.sortOrder}), -1)`,
        })
        .from(folders)
        .where(
          and(eq(folders.userId, userId), sql`${folders.parentId} is null`)
        )) as Array<{ max?: number }>;

      return (row?.max ?? -1) + 1;
    },

    async createInboxFolder(input) {
      await runner.insert(folders).values({
        id: input.id,
        userId: input.userId,
        name: AI_INBOX_FOLDER_NAME,
        parentId: null,
        sortOrder: input.sortOrder,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
    },

    async createFolder(input) {
      await runner.insert(folders).values({
        id: input.id,
        userId: input.userId,
        name: input.name,
        parentId: null,
        sortOrder: input.sortOrder,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
    },
  };
}

async function getDefaultAiInboxFolderRepository() {
  const { db } = await import("../db/index");
  return createAiInboxFolderRepository(db as unknown as AiInboxDbRunner);
}

export async function resolveOrCreateAiInboxFolder(
  userId: string,
  options: {
    repo?: AiInboxFolderRepository;
    randomUUID?: () => string;
  } = {}
) {
  const repo = options.repo ?? (await getDefaultAiInboxFolderRepository());
  const existing = await repo.findInboxFolder(userId);
  if (existing) {
    return existing.id;
  }

  const id = options.randomUUID?.() ?? crypto.randomUUID();
  const sortOrder = await repo.findNextRootSortOrder(userId);
  const now = new Date();
  await repo.createInboxFolder({
    id,
    userId,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function resolveOrCreateNamedFolder(
  userId: string,
  rawName: string,
  options: {
    repo?: AiInboxFolderRepository;
    randomUUID?: () => string;
  } = {}
) {
  const name = rawName.trim();
  if (!name) {
    throw new Error("resolveOrCreateNamedFolder: name must be a non-empty string");
  }

  const repo = options.repo ?? (await getDefaultAiInboxFolderRepository());
  const existing = await repo.findFolderByName(userId, name);
  if (existing) {
    return existing.id;
  }

  const id = options.randomUUID?.() ?? crypto.randomUUID();
  const sortOrder = await repo.findNextRootSortOrder(userId);
  const now = new Date();
  await repo.createFolder({
    id,
    userId,
    name,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
