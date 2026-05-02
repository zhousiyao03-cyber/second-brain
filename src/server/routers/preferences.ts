import { z } from "zod/v4";

import { router, protectedProcedure } from "../trpc";
import {
  listPreferences,
  setPreference,
  deletePreference,
} from "../integrations/preferences-store";

const scopeSchema = z
  .string()
  .refine(
    (s) =>
      s === "global" || /^project:[a-z0-9._-]+$/.test(s),
    {
      message: 'scope must be "global" or "project:<slug>"',
    }
  );

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, {
    message: "key must be snake_case",
  });

export const preferencesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          scope: scopeSchema.optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      return listPreferences({
        userId: ctx.userId,
        ...(input?.scope !== undefined ? { scope: input.scope } : {}),
      });
    }),

  set: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        key: keySchema,
        value: z.string().min(1),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return setPreference({
        userId: ctx.userId,
        scope: input.scope,
        key: input.key,
        value: input.value,
        description: input.description ?? null,
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        key: keySchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      return deletePreference({
        userId: ctx.userId,
        scope: input.scope,
        key: input.key,
      });
    }),
});
