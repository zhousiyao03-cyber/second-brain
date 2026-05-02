import { and, asc, eq } from "drizzle-orm";

import { db as defaultDb } from "../db";
import { preferences } from "../db/schema";

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SLUG_PATTERN = /^[a-z0-9._-]+$/;

export type PreferenceScope = "global" | `project:${string}`;

export type PreferenceRow = {
  id: string;
  scope: string;
  key: string;
  value: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoreDeps = {
  db?: typeof defaultDb;
  /** Override `Date.now()` for deterministic tests. Optional. */
  now?: () => Date;
};

function assertScope(scope: string): asserts scope is PreferenceScope {
  if (scope === "global") return;
  if (scope.startsWith("project:")) {
    const slug = scope.slice("project:".length);
    if (slug.length > 0 && SLUG_PATTERN.test(slug)) return;
  }
  throw new Error(
    `Invalid scope: ${JSON.stringify(scope)}. Expected "global" or "project:<slug>" where slug matches ${SLUG_PATTERN}.`
  );
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid key: ${JSON.stringify(key)}. Expected snake_case matching ${KEY_PATTERN}.`
    );
  }
}

function assertValue(value: string): void {
  if (value.trim().length === 0) {
    throw new Error("value must be non-empty after trim");
  }
}

function toRow(
  row: typeof preferences.$inferSelect
): PreferenceRow {
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    value: row.value,
    description: row.description ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function listPreferences(
  input: { userId: string; scope?: string },
  deps: StoreDeps = {}
): Promise<PreferenceRow[]> {
  const dbImpl = deps.db ?? defaultDb;

  const where =
    input.scope !== undefined
      ? and(
          eq(preferences.userId, input.userId),
          eq(preferences.scope, input.scope)
        )
      : eq(preferences.userId, input.userId);

  const rows = await dbImpl
    .select()
    .from(preferences)
    .where(where)
    .orderBy(asc(preferences.scope), asc(preferences.key));

  // Sort: "global" before any "project:*". DB returns alphabetical,
  // which puts "global" after "project:..." — fix client-side.
  return rows
    .map(toRow)
    .sort((a, b) => {
      const aGlobal = a.scope === "global" ? 0 : 1;
      const bGlobal = b.scope === "global" ? 0 : 1;
      if (aGlobal !== bGlobal) return aGlobal - bGlobal;
      if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
      return a.key.localeCompare(b.key);
    });
}

export async function setPreference(
  input: {
    userId: string;
    scope: string;
    key: string;
    value: string;
    description?: string | null;
  },
  deps: StoreDeps = {}
): Promise<{ id: string; created: boolean }> {
  assertScope(input.scope);
  assertKey(input.key);
  assertValue(input.value);

  const dbImpl = deps.db ?? defaultDb;
  const now = (deps.now ?? (() => new Date()))();

  const existing = await dbImpl
    .select()
    .from(preferences)
    .where(
      and(
        eq(preferences.userId, input.userId),
        eq(preferences.scope, input.scope),
        eq(preferences.key, input.key)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    await dbImpl
      .update(preferences)
      .set({
        value: input.value,
        description:
          input.description !== undefined
            ? input.description
            : row.description,
        updatedAt: now,
      })
      .where(eq(preferences.id, row.id));
    return { id: row.id, created: false };
  }

  const id = crypto.randomUUID();
  await dbImpl.insert(preferences).values({
    id,
    userId: input.userId,
    scope: input.scope,
    key: input.key,
    value: input.value,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, created: true };
}

export async function deletePreference(
  input: { userId: string; scope: string; key: string },
  deps: StoreDeps = {}
): Promise<{ deleted: boolean }> {
  assertScope(input.scope);
  assertKey(input.key);

  const dbImpl = deps.db ?? defaultDb;

  const result = await dbImpl
    .delete(preferences)
    .where(
      and(
        eq(preferences.userId, input.userId),
        eq(preferences.scope, input.scope),
        eq(preferences.key, input.key)
      )
    )
    .returning({ id: preferences.id });

  return { deleted: result.length > 0 };
}
