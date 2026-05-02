import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * A user-configured backend that can produce tokens.
 *
 *   kind = 'openai-compatible'  → HTTP, requires base_url + api_key_enc
 *   kind = 'local'              → HTTP (Ollama / LM Studio), requires base_url, no key
 *   kind = 'claude-code-daemon' → in-process queue, no base_url, no key
 *   kind = 'transformers'       → in-process Transformers.js (embedding only),
 *                                 no base_url, no key
 *
 * `label` is the user-facing name (e.g. "OpenAI", "DeepSeek", "Home Ollama").
 * Multiple rows of the same kind are allowed (e.g. a Personal + Work key).
 *
 * NOTE: SQLite does not enforce the kind/role enum at the SQL layer — every
 * insert path MUST pipe through zod validation at the tRPC router boundary
 * (Phase 6.1) before reaching `db.insert`. Bypassing zod risks invalid kind
 * values that crash `resolveAiCall` at runtime.
 */
export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["openai-compatible", "local", "claude-code-daemon", "transformers"],
    }).notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url"),
    apiKeyEnc: text("api_key_enc"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    userIdx: index("ai_providers_user_idx").on(t.userId),
  }),
);

/**
 * Per-user assignment of one provider+model pair to each AI role.
 *
 *   chat       → Ask AI / Council / Drifter
 *   task       → tag/summary/structured-output generation
 *   embedding  → RAG indexing (kind ∈ {openai-compatible, local, transformers})
 *
 * On delete restrict at the provider FK so deleting an in-use provider
 * forces the user to reassign the role first (UI surfaces a confirmation).
 *
 * NOTE: SQLite does not enforce the role enum at the SQL layer — every
 * insert path MUST pipe through zod validation at the tRPC router boundary
 * (Phase 6.1) before reaching `db.insert`. Bypassing zod risks invalid role
 * values that crash `resolveAiCall` at runtime.
 */
export const aiRoleAssignments = sqliteTable(
  "ai_role_assignments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["chat", "task", "embedding"] }).notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    modelId: text("model_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);
