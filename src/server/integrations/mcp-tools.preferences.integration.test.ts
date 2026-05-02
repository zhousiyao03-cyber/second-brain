import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";

import { callKnosiMcpTool, defaultDeps } from "./mcp-tools";
import {
  listPreferences,
  setPreference,
  deletePreference,
} from "./preferences-store";
import * as schema from "../db/schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
const TEST_USER = "user-mcp-int";

async function makeDb(): Promise<DB> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.users).values({
    id: TEST_USER,
    email: `${TEST_USER}@test.local`,
    name: "Test",
  });
  return db;
}

describe("MCP integration — knosi_pref_* end-to-end against in-memory DB", () => {
  let db: DB;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("set → list → update → delete round-trip", async () => {
    const deps = {
      ...defaultDeps,
      listPreferences: (input: Parameters<typeof listPreferences>[0]) =>
        listPreferences(input, { db: db as never }),
      setPreference: (input: Parameters<typeof setPreference>[0]) =>
        setPreference(input, { db: db as never }),
      deletePreference: (input: Parameters<typeof deletePreference>[0]) =>
        deletePreference(input, { db: db as never }),
    };

    const setResult = await callKnosiMcpTool(
      {
        userId: TEST_USER,
        name: "knosi_pref_set",
        arguments: {
          scope: "global",
          key: "package_manager",
          value: "pnpm",
        },
      },
      deps as never
    );
    expect(setResult).toMatchObject({ created: true });

    const listAll = await callKnosiMcpTool(
      { userId: TEST_USER, name: "knosi_pref_list", arguments: {} },
      deps as never
    );
    expect((listAll as { items: unknown[] }).items).toHaveLength(1);

    const setResult2 = await callKnosiMcpTool(
      {
        userId: TEST_USER,
        name: "knosi_pref_set",
        arguments: {
          scope: "global",
          key: "package_manager",
          value: "yarn",
        },
      },
      deps as never
    );
    expect(setResult2).toMatchObject({ created: false });

    const delResult = await callKnosiMcpTool(
      {
        userId: TEST_USER,
        name: "knosi_pref_delete",
        arguments: { scope: "global", key: "package_manager" },
      },
      deps as never
    );
    expect(delResult).toMatchObject({ deleted: true });

    const listEmpty = await callKnosiMcpTool(
      { userId: TEST_USER, name: "knosi_pref_list", arguments: {} },
      deps as never
    );
    expect((listEmpty as { items: unknown[] }).items).toHaveLength(0);
  });
});
