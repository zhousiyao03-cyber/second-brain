import { and, eq } from "drizzle-orm";
import type { z } from "zod/v4";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { publishDaemonTaskNotification } from "@/server/ai/daemon-task-notifications";
import { buildStructuredJsonPrompt, extractJsonObject } from "./shared";
import type { GenerateStructuredDataOptions } from "./types";

export async function generateStructuredDataDaemon<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema> & {
    modelId: string;
    userId: string;
  },
): Promise<z.infer<TSchema>> {
  const { description, name, prompt, schema, signal, modelId, userId } = options;
  const fullPrompt = buildStructuredJsonPrompt({ description, name, prompt, schema });

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId,
    status: "queued",
    taskType: "structured",
    sourceScope: "direct",
    messages: "[]",
    systemPrompt: fullPrompt,
    model: modelId,
  });
  await publishDaemonTaskNotification({
    kind: "wake",
    userId,
    taskType: "structured",
  });

  const POLL_INTERVAL = 300;
  const TIMEOUT = 120_000;
  const deadline = Date.now() + TIMEOUT;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await db
        .update(chatTasks)
        .set({ status: "cancelled" })
        .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
      throw new Error("Aborted");
    }

    const [row] = await db
      .select({
        status: chatTasks.status,
        structuredResult: chatTasks.structuredResult,
        error: chatTasks.error,
      })
      .from(chatTasks)
      .where(eq(chatTasks.id, taskId));

    if (!row) throw new Error(`Daemon task ${taskId} disappeared`);

    if (row.status === "completed" && row.structuredResult) {
      return schema.parse(JSON.parse(extractJsonObject(row.structuredResult)));
    }

    if (row.status === "failed") {
      throw new Error(row.error || `Daemon structured task failed: ${taskId}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  await db
    .update(chatTasks)
    .set({ status: "cancelled" })
    .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
  throw new Error(`Daemon structured task timed out: ${taskId}`);
}
