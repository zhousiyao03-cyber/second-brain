import { readFile } from "node:fs/promises";
import { z } from "zod";

const hostSnapshotSchema = z.object({
  generatedAt: z.string(),
  host: z.object({
    uptimeSeconds: z.number(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    memory: z.object({
      usedBytes: z.number(),
      totalBytes: z.number(),
    }),
    disk: z.object({
      usedBytes: z.number(),
      totalBytes: z.number(),
      mount: z.string(),
    }),
  }),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["healthy", "degraded", "unknown"]),
      detail: z.string().nullable().optional(),
    })
  ),
});

export function parseOpsHostSnapshot(raw: string) {
  try {
    const parsed = hostSnapshotSchema.parse(JSON.parse(raw));
    return { available: true as const, snapshot: parsed };
  } catch (error) {
    return {
      available: false as const,
      reason: error instanceof Error ? error.message : "invalid host snapshot",
    };
  }
}

export async function readOpsHostSnapshot() {
  try {
    const raw = await readFile("/app/runtime/ops-snapshot.json", "utf8");
    return parseOpsHostSnapshot(raw);
  } catch (error) {
    return {
      available: false as const,
      reason: error instanceof Error ? error.message : "host snapshot unavailable",
    };
  }
}
