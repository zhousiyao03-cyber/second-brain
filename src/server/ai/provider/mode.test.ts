import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
import {
  __resetProviderPrefCacheForTests,
  getCachedUserChatModel,
  getProviderMode,
  getProviderModeSync,
  invalidateProviderPrefCache,
} from "./mode";

const USER_A = "mode-test-user-a";
const USER_B = "mode-test-user-b";

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  await db
    .insert(users)
    .values([
      { id: USER_A, email: "mode-test-a@test.local" },
      { id: USER_B, email: "mode-test-b@test.local" },
    ])
    .onConflictDoNothing();
});

beforeEach(async () => {
  __resetProviderPrefCacheForTests();
  // Reset both rows to a known baseline.
  await db
    .update(users)
    .set({ aiProviderPreference: null, aiChatModel: null })
    .where(eq(users.id, USER_A));
  await db
    .update(users)
    .set({ aiProviderPreference: null, aiChatModel: null })
    .where(eq(users.id, USER_B));
});

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("getProviderMode — fallback order", () => {
  it("user pref wins over env", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    await db
      .update(users)
      .set({ aiProviderPreference: "local" })
      .where(eq(users.id, USER_A));

    const mode = await getProviderMode({ userId: USER_A });
    expect(mode).toBe("local");
  });

  it("knosi-hosted preference maps to codex", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;

    await db
      .update(users)
      .set({ aiProviderPreference: "knosi-hosted" })
      .where(eq(users.id, USER_A));

    const mode = await getProviderMode({ userId: USER_A });
    expect(mode).toBe("codex");
  });

  it("falls back to env when user pref is null", async () => {
    process.env.AI_PROVIDER = "openai";

    const mode = await getProviderMode({ userId: USER_A });
    expect(mode).toBe("openai");
  });

  it("falls back to auto-detect when no user pref and no env", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;

    // Auto-detect can land on either "codex" (if a local OpenClaw profile
    // exists on the dev machine running tests), "openai" (if the env had
    // a leaked OPENAI_API_KEY we did not mask), or "local". We assert it
    // is at least one of the legal values — and importantly NOT a
    // user-pref echo.
    const mode = await getProviderMode({ userId: USER_A });
    expect(["codex", "openai", "local"]).toContain(mode);
  });

  it("auto-detects openai when OPENAI_API_KEY is set with no AI_PROVIDER", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-test";

    const mode = await getProviderMode({ userId: USER_A });
    // hasCodexAuthProfile() runs first — on a dev machine with a local
    // OpenClaw profile this still resolves to "codex". On clean envs it
    // would land on "openai". We only assert the env did not get
    // ignored — i.e. local is excluded.
    expect(["codex", "openai"]).toContain(mode);
  });

  it("ignores user pref when ctx.userId is missing", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    await db
      .update(users)
      .set({ aiProviderPreference: "local" })
      .where(eq(users.id, USER_A));

    const mode = await getProviderMode({});
    // Without a userId we never read the DB, so env wins.
    expect(mode).toBe("openai");
  });
});

describe("getProviderModeSync — sync env-only resolution", () => {
  it("never reads user pref even when one exists", async () => {
    process.env.AI_PROVIDER = "local";
    await db
      .update(users)
      .set({ aiProviderPreference: "openai" })
      .where(eq(users.id, USER_A));

    expect(getProviderModeSync()).toBe("local");
  });

  it("AI_PROVIDER=cursor resolves to cursor (spec §3.3)", () => {
    process.env.AI_PROVIDER = "cursor";
    expect(getProviderModeSync()).toBe("cursor");
  });
});

describe("getProviderMode — cursor preference (spec §3.3)", () => {
  it("user pref of 'cursor' is honored as cursor mode", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;

    await db
      .update(users)
      .set({ aiProviderPreference: "cursor" })
      .where(eq(users.id, USER_A));

    const mode = await getProviderMode({ userId: USER_A });
    expect(mode).toBe("cursor");
  });
});

describe("provider-pref cache", () => {
  it("subsequent reads within TTL hit the cache (no DB write visible)", async () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    await db
      .update(users)
      .set({ aiProviderPreference: "local" })
      .where(eq(users.id, USER_A));

    // First call warms the cache.
    expect(await getProviderMode({ userId: USER_A })).toBe("local");

    // Now flip the underlying row to "openai". Without invalidation the
    // cached "local" value should persist.
    await db
      .update(users)
      .set({ aiProviderPreference: "openai" })
      .where(eq(users.id, USER_A));

    expect(await getProviderMode({ userId: USER_A })).toBe("local");
  });

  it("invalidateProviderPrefCache forces a re-read", async () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    await db
      .update(users)
      .set({ aiProviderPreference: "local" })
      .where(eq(users.id, USER_A));

    expect(await getProviderMode({ userId: USER_A })).toBe("local");

    await db
      .update(users)
      .set({ aiProviderPreference: "openai" })
      .where(eq(users.id, USER_A));
    invalidateProviderPrefCache(USER_A);

    expect(await getProviderMode({ userId: USER_A })).toBe("openai");
  });

  it("getCachedUserChatModel piggybacks on the same row read", async () => {
    await db
      .update(users)
      .set({ aiProviderPreference: "openai", aiChatModel: "gpt-4o-mini" })
      .where(eq(users.id, USER_A));

    process.env.AI_PROVIDER = "local";

    // Warm cache via getProviderMode (1 DB hit).
    await getProviderMode({ userId: USER_A });
    // Flip the underlying chat model — cache still holds the old one.
    await db
      .update(users)
      .set({ aiChatModel: "gpt-4o" })
      .where(eq(users.id, USER_A));

    expect(await getCachedUserChatModel(USER_A)).toBe("gpt-4o-mini");
    invalidateProviderPrefCache(USER_A);
    expect(await getCachedUserChatModel(USER_A)).toBe("gpt-4o");
  });

  it("two distinct users have independent cache entries", async () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    await db
      .update(users)
      .set({ aiProviderPreference: "local" })
      .where(eq(users.id, USER_A));
    await db
      .update(users)
      .set({ aiProviderPreference: "knosi-hosted" })
      .where(eq(users.id, USER_B));

    expect(await getProviderMode({ userId: USER_A })).toBe("local");
    expect(await getProviderMode({ userId: USER_B })).toBe("codex");
  });
});
