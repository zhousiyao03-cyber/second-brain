import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Tracks one persistent Claude Code CLI conversation per (user, workerKey).
 * The daemon stores the latest CLI session id captured from `system/init`
 * events; subsequent spawns use `claude --resume <cliSessionId>` to recover
 * the conversation context without retransmitting the message history.
 *
 * `workerKey` format: `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`.
 * The userId is duplicated in the key for client-side debugging convenience;
 * the userId column is the auth source of truth and what the unique index
 * scopes by.
 */
export const daemonConversations = sqliteTable(
  "daemon_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workerKey: text("worker_key").notNull(),
    cliSessionId: text("cli_session_id"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userWorkerIdx: uniqueIndex("daemon_conversations_user_worker_idx").on(
      table.userId,
      table.workerKey
    ),
  })
);
