import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Council module — multi-agent discussion rooms.
 * Spec: docs/superpowers/specs/2026-05-01-council-multi-agent-room-design.md
 */

export const councilPersonas = sqliteTable(
  "council_personas",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    avatarEmoji: text("avatar_emoji"),
    systemPrompt: text("system_prompt").notNull(),
    styleHint: text("style_hint"),
    // Phase 1 enum: 'all' | 'notes' | 'bookmarks'
    scopeKind: text("scope_kind").notNull(),
    scopeRefId: text("scope_ref_id"),
    scopeTags: text("scope_tags"), // JSON string[]
    isPreset: integer("is_preset", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("council_personas_user_idx").on(t.userId),
  })
);

export const councilChannels = sqliteTable(
  "council_channels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    topic: text("topic"),
    hardLimitPerTurn: integer("hard_limit_per_turn").notNull().default(6),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("council_channels_user_idx").on(t.userId),
  })
);

export const councilChannelPersonas = sqliteTable(
  "council_channel_personas",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => councilChannels.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => councilPersonas.id, { onDelete: "restrict" }),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.channelId, t.personaId] }),
  })
);

export const councilChannelMessages = sqliteTable(
  "council_channel_messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => councilChannels.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "agent", "system"] }).notNull(),
    personaId: text("persona_id").references(() => councilPersonas.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    status: text("status", {
      enum: ["complete", "interrupted", "error"],
    })
      .notNull()
      .default("complete"),
    turnId: text("turn_id"),
    metadata: text("metadata"), // JSON
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    channelIdx: index("council_messages_channel_idx").on(
      t.channelId,
      t.createdAt
    ),
    turnIdx: index("council_messages_turn_idx").on(t.turnId),
  })
);
