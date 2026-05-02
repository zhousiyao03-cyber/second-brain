import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Agent context layer — Phase 1.
 *
 * Holds cross-agent preferences. Each row is a single (scope, key) constraint
 * (e.g. global response_language="Always reply in Chinese"). Agents pull these
 * at session start via the knosi_pref_* MCP tools.
 *
 * scope is either the literal string "global" or "project:<slug>" where slug
 * matches /^[a-z0-9._-]+$/. Application-layer code enforces the format; the
 * DB stores it as a plain string for simplicity.
 */
export const preferences = sqliteTable(
  "preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("preferences_user_scope_key_idx").on(
      table.userId,
      table.scope,
      table.key
    ),
    index("preferences_user_scope_idx").on(table.userId, table.scope),
  ]
);
