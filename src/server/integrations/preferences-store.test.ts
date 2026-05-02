import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";

import {
  listPreferences,
  setPreference,
  deletePreference,
} from "./preferences-store";
import * as schema from "../db/schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

const TEST_USER = "user-acl-1";

async function makeDb(): Promise<DB> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // seed user FK target
  await db.insert(schema.users).values({
    id: TEST_USER,
    email: `${TEST_USER}@test.local`,
    name: "Test",
  });
  return db;
}

describe("preferences-store", () => {
  let db: DB;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("listPreferences returns [] for a fresh user", async () => {
    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toEqual([]);
  });

  it("setPreference inserts a new row and reports created=true", async () => {
    const result = await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "response_language",
        value: "Always reply in Chinese",
      },
      { db: db as never }
    );
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("string");

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "global",
      key: "response_language",
      value: "Always reply in Chinese",
    });
  });

  it("setPreference upserts on (scope,key) and reports created=false", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "package_manager",
        value: "pnpm",
      },
      { db: db as never }
    );
    const second = await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "package_manager",
        value: "yarn",
      },
      { db: db as never }
    );
    expect(second.created).toBe(false);

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("yarn");
  });

  it("listPreferences filters by scope when provided", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "response_language",
        value: "Chinese",
      },
      { db: db as never }
    );
    await setPreference(
      {
        userId: TEST_USER,
        scope: "project:knosi",
        key: "package_manager",
        value: "pnpm",
      },
      { db: db as never }
    );

    const globalOnly = await listPreferences(
      { userId: TEST_USER, scope: "global" },
      { db: db as never }
    );
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0]?.key).toBe("response_language");

    const knosiOnly = await listPreferences(
      { userId: TEST_USER, scope: "project:knosi" },
      { db: db as never }
    );
    expect(knosiOnly).toHaveLength(1);
    expect(knosiOnly[0]?.key).toBe("package_manager");
  });

  it("listPreferences sorts by scope (global first), then key", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "project:knosi",
        key: "z_key",
        value: "v",
      },
      { db: db as never }
    );
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "b_key", value: "v" },
      { db: db as never }
    );
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "a_key", value: "v" },
      { db: db as never }
    );

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows.map((r) => `${r.scope}/${r.key}`)).toEqual([
      "global/a_key",
      "global/b_key",
      "project:knosi/z_key",
    ]);
  });

  it("deletePreference returns deleted=true on hit, false on miss", async () => {
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "x", value: "v" },
      { db: db as never }
    );

    const hit = await deletePreference(
      { userId: TEST_USER, scope: "global", key: "x" },
      { db: db as never }
    );
    expect(hit.deleted).toBe(true);

    const miss = await deletePreference(
      { userId: TEST_USER, scope: "global", key: "x" },
      { db: db as never }
    );
    expect(miss.deleted).toBe(false);
  });

  it("setPreference rejects empty key", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/key/i);
  });

  it("setPreference rejects key with bad chars", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "Bad-Key", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/key/i);
  });

  it("setPreference rejects empty value", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "k", value: "   " },
        { db: db as never }
      )
    ).rejects.toThrow(/value/i);
  });

  it("setPreference rejects malformed scope", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "weird", key: "k", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/scope/i);
  });

  it("setPreference rejects bad project slug in scope", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "project:Bad Slug!", key: "k", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/scope/i);
  });

  it("isolates rows per user", async () => {
    await db.insert(schema.users).values({
      id: "user-other",
      email: "other@test.local",
      name: "Other",
    });
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "k", value: "mine" },
      { db: db as never }
    );
    await setPreference(
      { userId: "user-other", scope: "global", key: "k", value: "theirs" },
      { db: db as never }
    );
    const mine = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.value).toBe("mine");
  });
});
