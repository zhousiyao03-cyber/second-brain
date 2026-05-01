import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
import { resolveAiSdkModelId, resolveAiSdkModelIdSync } from "./ai-sdk";
import { __resetProviderPrefCacheForTests } from "./mode";

const USER_ID = "ai-sdk-test-user";

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  await db
    .insert(users)
    .values({ id: USER_ID, email: "ai-sdk-test@test.local" })
    .onConflictDoNothing();
});

const ENV_KEYS = [
  "OPENAI_CHAT_MODEL",
  "OPENAI_TASK_MODEL",
  "OPENAI_MODEL",
  "AI_CHAT_MODEL",
  "AI_TASK_MODEL",
  "AI_MODEL",
  "LOCAL_AI_CHAT_MODEL",
  "LOCAL_AI_TASK_MODEL",
  "LOCAL_AI_MODEL",
  "CURSOR_CHAT_MODEL",
  "CURSOR_TASK_MODEL",
  "CURSOR_MODEL",
  "CURSOR_PROXY_URL",
  "CURSOR_PROXY_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetProviderPrefCacheForTests();
  await db
    .update(users)
    .set({ aiChatModel: null, aiProviderPreference: null })
    .where(eq(users.id, USER_ID));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("resolveAiSdkModelId — chat kind", () => {
  it("user-saved model wins over env", async () => {
    process.env.OPENAI_CHAT_MODEL = "from-env-chat";
    await db
      .update(users)
      .set({ aiChatModel: "user-pick-gpt-4o-mini" })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("chat", "openai", { userId: USER_ID });
    expect(id).toBe("user-pick-gpt-4o-mini");
  });

  it("trims whitespace on the user value", async () => {
    await db
      .update(users)
      .set({ aiChatModel: "   gpt-4o   " })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("chat", "openai", { userId: USER_ID });
    expect(id).toBe("gpt-4o");
  });

  it("falls back to env when user model is null", async () => {
    process.env.OPENAI_CHAT_MODEL = "env-only-chat";

    const id = await resolveAiSdkModelId("chat", "openai", { userId: USER_ID });
    expect(id).toBe("env-only-chat");
  });

  it("falls back to built-in default when no user / env", async () => {
    const id = await resolveAiSdkModelId("chat", "openai", { userId: USER_ID });
    expect(id).toBe("gpt-5.4");
  });

  it("ignores user model when ctx.userId is absent", async () => {
    process.env.OPENAI_CHAT_MODEL = "env-chat";
    await db
      .update(users)
      .set({ aiChatModel: "should-be-ignored" })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("chat", "openai");
    expect(id).toBe("env-chat");
  });

  it("local mode falls back to AI_CHAT_MODEL → AI_MODEL → built-in", async () => {
    const a = await resolveAiSdkModelId("chat", "local");
    expect(a).toBe("qwen2.5:14b");

    process.env.AI_CHAT_MODEL = "llama3.2";
    const b = await resolveAiSdkModelId("chat", "local");
    expect(b).toBe("llama3.2");
  });
});

describe("resolveAiSdkModelId — task kind ignores user pref (spec §3.4)", () => {
  it("task never reads users.aiChatModel", async () => {
    process.env.OPENAI_TASK_MODEL = "env-task-model";
    await db
      .update(users)
      .set({ aiChatModel: "user-chat-only" })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("task", "openai", { userId: USER_ID });
    expect(id).toBe("env-task-model");
  });

  it("task falls through to built-in when no env", async () => {
    const id = await resolveAiSdkModelId("task", "openai", { userId: USER_ID });
    expect(id).toBe("gpt-5.4");
  });
});

describe("resolveAiSdkModelIdSync — env-only path", () => {
  it("never reads user pref", async () => {
    process.env.OPENAI_CHAT_MODEL = "env-chat-sync";
    await db
      .update(users)
      .set({ aiChatModel: "user-pick-ignored" })
      .where(eq(users.id, USER_ID));

    expect(resolveAiSdkModelIdSync("chat", "openai")).toBe("env-chat-sync");
  });
});

describe("cursor mode (spec §3.2)", () => {
  it("chat falls back to built-in cursor default when no user / env", async () => {
    const id = await resolveAiSdkModelId("chat", "cursor", { userId: USER_ID });
    expect(id).toBe("claude-4.6-sonnet-medium");
  });

  it("CURSOR_CHAT_MODEL env wins over the built-in default", async () => {
    process.env.CURSOR_CHAT_MODEL = "claude-4.6-opus-high";
    const id = await resolveAiSdkModelId("chat", "cursor", { userId: USER_ID });
    expect(id).toBe("claude-4.6-opus-high");
  });

  it("CURSOR_MODEL is honored when CURSOR_CHAT_MODEL is unset", async () => {
    process.env.CURSOR_MODEL = "gpt-5.5-medium";
    const id = await resolveAiSdkModelId("chat", "cursor", { userId: USER_ID });
    expect(id).toBe("gpt-5.5-medium");
  });

  it("user pref still wins over cursor env (kind=chat)", async () => {
    process.env.CURSOR_CHAT_MODEL = "from-env-cursor";
    await db
      .update(users)
      .set({ aiChatModel: "user-pick-cursor" })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("chat", "cursor", { userId: USER_ID });
    expect(id).toBe("user-pick-cursor");
  });

  it("task kind ignores user pref and uses cursor task default", async () => {
    await db
      .update(users)
      .set({ aiChatModel: "user-chat-only" })
      .where(eq(users.id, USER_ID));

    const id = await resolveAiSdkModelId("task", "cursor", { userId: USER_ID });
    expect(id).toBe("claude-4.6-sonnet-medium");
  });

  it("resolveAiSdkModelIdSync returns the cursor default", () => {
    expect(resolveAiSdkModelIdSync("chat", "cursor")).toBe(
      "claude-4.6-sonnet-medium",
    );
  });
});
