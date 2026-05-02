import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Drifter — AI text companion game ("树洞旅人").
 * Spec: docs/superpowers/specs/2026-05-01-drifter-design.md
 *
 * Three tables:
 *   drifter_sessions   — one visit
 *   drifter_messages   — turns within a visit
 *   drifter_memories   — long-lived facts Pip remembers about the visitor
 */

export const drifterSessions = sqliteTable(
  "drifter_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    weather: text("weather", {
      enum: ["clear", "rain", "snow", "fireflies"],
    }).notNull(),
    timeOfDay: text("time_of_day", {
      enum: ["dusk", "night", "deep_night", "predawn", "day"],
    }).notNull(),
    language: text("language", { enum: ["en", "zh", "mixed"] })
      .notNull()
      .default("en"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (t) => ({
    userIdx: index("drifter_sessions_user_idx").on(t.userId, t.startedAt),
  })
);

export const drifterMessages = sqliteTable(
  "drifter_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => drifterSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "pip"] }).notNull(),
    content: text("content").notNull(),
    emotion: text("emotion", {
      enum: ["gentle", "smile", "thinking", "concerned", "sleepy"],
    }),
    status: text("status", { enum: ["complete", "interrupted", "error"] })
      .notNull()
      .default("complete"),
    hooks: text("hooks"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    sessionIdx: index("drifter_messages_session_idx").on(
      t.sessionId,
      t.createdAt
    ),
  })
);

export const drifterMemories = sqliteTable(
  "drifter_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    sourceMessageId: text("source_message_id").references(
      () => drifterMessages.id,
      { onDelete: "set null" }
    ),
    importance: integer("importance").notNull().default(3),
    createdAt: integer("created_at").notNull(),
    lastReferencedAt: integer("last_referenced_at"),
  },
  (t) => ({
    userIdx: index("drifter_memories_user_idx").on(t.userId, t.importance),
  })
);
