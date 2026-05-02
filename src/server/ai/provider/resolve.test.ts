import path from "node:path";
import { eq, and } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
import { aiProviders, aiRoleAssignments } from "@/server/db/schema/ai-providers";
import { encryptApiKey } from "@/server/ai/crypto";
import { MissingAiRoleError } from "./types";
import {
  __resetProviderCacheForTests,
  invalidateProviderCache,
  resolveAiCall,
} from "./resolve";

const USER = "resolve-test-user";

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  await db.insert(users).values({ id: USER, email: "resolve@test.local" }).onConflictDoNothing();
});

beforeEach(async () => {
  __resetProviderCacheForTests();
  await db.delete(aiRoleAssignments).where(eq(aiRoleAssignments.userId, USER));
  await db.delete(aiProviders).where(eq(aiProviders.userId, USER));
});

describe("resolveAiCall", () => {
  it("throws MissingAiRoleError when no role assignment exists", async () => {
    await expect(resolveAiCall("chat", USER)).rejects.toThrow(MissingAiRoleError);
  });

  it("resolves an openai-compatible chat assignment with decrypted key", async () => {
    const providerId = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: providerId,
      userId: USER,
      kind: "openai-compatible",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnc: encryptApiKey("sk-test-secret"),
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId,
      modelId: "gpt-4o",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("openai-compatible");
    if (r.kind !== "openai-compatible") throw new Error("type narrow");
    expect(r.baseURL).toBe("https://api.openai.com/v1");
    expect(r.apiKey).toBe("sk-test-secret");
    expect(r.modelId).toBe("gpt-4o");
    expect(r.label).toBe("OpenAI");
  });

  it("resolves a local provider with no api key", async () => {
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "local",
      label: "Home Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId: id,
      modelId: "qwen2.5:14b",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("local");
  });

  it("resolves a claude-code-daemon provider (no baseURL, no key)", async () => {
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "claude-code-daemon",
      label: "Claude CLI",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId: id,
      modelId: "opus",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("claude-code-daemon");
    if (r.kind !== "claude-code-daemon") throw new Error("type narrow");
    expect(r.modelId).toBe("opus");
  });

  it("resolves a transformers provider for embedding role", async () => {
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "transformers",
      label: "Local Embedding",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "embedding",
      providerId: id,
      modelId: "Xenova/multilingual-e5-small",
    });

    const r = await resolveAiCall("embedding", USER);
    expect(r.kind).toBe("transformers");
    if (r.kind !== "transformers") throw new Error("type narrow");
    expect(r.modelId).toBe("Xenova/multilingual-e5-small");
    expect(r.label).toBe("Local Embedding");
  });

  it("rejects daemon provider for embedding role even if assigned", async () => {
    // schema doesn't enforce this — runtime tripwire does.
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "claude-code-daemon",
      label: "Claude CLI",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "embedding",
      providerId: id,
      modelId: "opus",
    });

    await expect(resolveAiCall("embedding", USER)).rejects.toThrow(
      /embedding.*daemon/i,
    );
  });

  it("cache survives within TTL; invalidation forces re-read", async () => {
    const id1 = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: id1,
      userId: USER,
      kind: "openai-compatible",
      label: "First",
      baseUrl: "https://a.example/v1",
      apiKeyEnc: encryptApiKey("sk-a"),
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER, role: "chat", providerId: id1, modelId: "m1",
    });

    expect((await resolveAiCall("chat", USER)).label).toBe("First");

    // Switch underlying assignment without invalidating.
    const id2 = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: id2, userId: USER, kind: "openai-compatible",
      label: "Second", baseUrl: "https://b.example/v1",
      apiKeyEnc: encryptApiKey("sk-b"),
    });
    await db
      .update(aiRoleAssignments)
      .set({ providerId: id2, modelId: "m2" })
      .where(and(eq(aiRoleAssignments.userId, USER), eq(aiRoleAssignments.role, "chat")));

    expect((await resolveAiCall("chat", USER)).label).toBe("First"); // cached

    invalidateProviderCache(USER);
    expect((await resolveAiCall("chat", USER)).label).toBe("Second");
  });
});
