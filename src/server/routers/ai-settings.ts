import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/server/db";
import {
  aiProviders,
  aiRoleAssignments,
} from "@/server/db/schema/ai-providers";
import { decryptApiKey, encryptApiKey } from "@/server/ai/crypto";
import { invalidateProviderCache } from "@/server/ai/provider/resolve";
import { probeProvider } from "@/server/ai/provider/probe";
import { protectedProcedure, router } from "@/server/trpc";

const KIND = z.enum([
  "openai-compatible",
  "local",
  "claude-code-daemon",
  "transformers",
]);
const ROLE = z.enum(["chat", "task", "embedding"]);

function requireUser(ctx: unknown): string {
  const userId = (ctx as { userId?: string }).userId;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

export const aiSettingsRouter = router({
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUser(ctx);
    const rows = await db
      .select({
        id: aiProviders.id,
        kind: aiProviders.kind,
        label: aiProviders.label,
        baseUrl: aiProviders.baseUrl,
        apiKeyEnc: aiProviders.apiKeyEnc,
      })
      .from(aiProviders)
      .where(eq(aiProviders.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      baseUrl: r.baseUrl,
      hasApiKey: Boolean(r.apiKeyEnc),
    }));
  }),

  addProvider: protectedProcedure
    .input(
      z.object({
        kind: KIND,
        label: z.string().trim().min(1).max(80),
        baseUrl: z.string().trim().url().nullable(),
        apiKey: z.string().trim().min(1).max(500).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      if (input.kind === "openai-compatible") {
        if (!input.baseUrl || !input.apiKey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "openai-compatible requires baseUrl + apiKey",
          });
        }
      } else if (input.kind === "local") {
        if (!input.baseUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "local requires baseUrl",
          });
        }
      }
      const id = crypto.randomUUID();
      await db.insert(aiProviders).values({
        id,
        userId,
        kind: input.kind,
        label: input.label,
        baseUrl: input.baseUrl ?? null,
        apiKeyEnc: input.apiKey ? encryptApiKey(input.apiKey) : null,
      });
      invalidateProviderCache(userId);
      return { id };
    }),

  updateProvider: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        label: z.string().trim().min(1).max(80).optional(),
        baseUrl: z.string().trim().url().nullable().optional(),
        apiKey: z.string().trim().min(1).max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) patch.label = input.label;
      if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
      if (input.apiKey !== undefined) {
        patch.apiKeyEnc =
          input.apiKey === null ? null : encryptApiKey(input.apiKey);
      }
      await db
        .update(aiProviders)
        .set(patch)
        .where(
          and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)),
        );
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),

  deleteProvider: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [refRow] = await db
        .select({ role: aiRoleAssignments.role })
        .from(aiRoleAssignments)
        .where(
          and(
            eq(aiRoleAssignments.providerId, input.id),
            eq(aiRoleAssignments.userId, userId),
          ),
        )
        .limit(1);
      if (refRow) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Provider is used by role "${refRow.role}". Reassign the role before deleting.`,
        });
      }
      await db
        .delete(aiProviders)
        .where(
          and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)),
        );
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),

  testProvider: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [row] = await db
        .select({
          kind: aiProviders.kind,
          baseUrl: aiProviders.baseUrl,
          apiKeyEnc: aiProviders.apiKeyEnc,
        })
        .from(aiProviders)
        .where(
          and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.kind === "openai-compatible") {
        if (!row.baseUrl || !row.apiKeyEnc) {
          return { ok: false as const, error: "Missing baseURL or apiKey" };
        }
        return probeProvider({
          kind: "openai-compatible",
          baseURL: row.baseUrl,
          apiKey: decryptApiKey(row.apiKeyEnc),
        });
      }
      if (row.kind === "local") {
        if (!row.baseUrl)
          return { ok: false as const, error: "Missing baseURL" };
        return probeProvider({ kind: "local", baseURL: row.baseUrl });
      }
      if (row.kind === "claude-code-daemon")
        return probeProvider({ kind: "claude-code-daemon" });
      return probeProvider({ kind: "transformers" });
    }),

  listProviderModels: protectedProcedure
    .input(z.object({ id: z.string(), refresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [row] = await db
        .select({
          kind: aiProviders.kind,
          baseUrl: aiProviders.baseUrl,
          apiKeyEnc: aiProviders.apiKeyEnc,
        })
        .from(aiProviders)
        .where(
          and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.kind === "openai-compatible" && row.baseUrl && row.apiKeyEnc) {
        const r = await probeProvider({
          kind: "openai-compatible",
          baseURL: row.baseUrl,
          apiKey: decryptApiKey(row.apiKeyEnc),
        });
        return { models: r.ok ? r.models : [] };
      }
      if (row.kind === "local" && row.baseUrl) {
        const r = await probeProvider({ kind: "local", baseURL: row.baseUrl });
        return { models: r.ok ? r.models : [] };
      }
      if (row.kind === "claude-code-daemon")
        return { models: ["opus", "sonnet"] };
      return { models: ["Xenova/multilingual-e5-small"] };
    }),

  getRoleAssignments: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUser(ctx);
    const rows = await db
      .select()
      .from(aiRoleAssignments)
      .where(eq(aiRoleAssignments.userId, userId));
    const out: Record<string, { providerId: string; modelId: string } | null> =
      {
        chat: null,
        task: null,
        embedding: null,
      };
    for (const r of rows) {
      out[r.role] = { providerId: r.providerId, modelId: r.modelId };
    }
    return out;
  }),

  setRoleAssignment: protectedProcedure
    .input(
      z.object({
        role: ROLE,
        providerId: z.string(),
        modelId: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [provider] = await db
        .select({ kind: aiProviders.kind })
        .from(aiProviders)
        .where(
          and(
            eq(aiProviders.id, input.providerId),
            eq(aiProviders.userId, userId),
          ),
        )
        .limit(1);
      if (!provider)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Provider not found",
        });
      if (
        input.role === "embedding" &&
        provider.kind === "claude-code-daemon"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "claude-code-daemon cannot serve the embedding role.",
        });
      }
      if (input.role !== "embedding" && provider.kind === "transformers") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "transformers kind only serves the embedding role.",
        });
      }
      await db
        .insert(aiRoleAssignments)
        .values({
          userId,
          role: input.role,
          providerId: input.providerId,
          modelId: input.modelId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [aiRoleAssignments.userId, aiRoleAssignments.role],
          set: {
            providerId: input.providerId,
            modelId: input.modelId,
            updatedAt: new Date(),
          },
        });
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),
});
