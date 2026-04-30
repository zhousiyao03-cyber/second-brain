import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

export const learningPaths = sqliteTable(
  "learning_paths",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", {
      enum: ["backend", "database", "devops", "ai", "system-design"],
    }),
    lessons: text("lessons"), // JSON, lesson list & order
    progress: real("progress").default(0), // 0-100
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("learning_paths_user_idx").on(table.userId)]
);

export const learningLessons = sqliteTable(
  "learning_lessons",
  {
    id: text("id").primaryKey(),
    pathId: text("path_id").references(() => learningPaths.id),
    title: text("title").notNull(),
    content: text("content"), // AI generated lesson content
    quiz: text("quiz"), // JSON, exercises
    orderIndex: integer("order_index"),
    status: text("status", { enum: ["locked", "available", "completed"] }).default("locked"),
    notes: text("notes"), // user study notes
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [index("learning_lessons_path_idx").on(table.pathId)]
);

// ── Learning Notebook ──────────────────────────────

export const learningTopics = sqliteTable(
  "learning_topics",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    icon: text("icon"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("learning_topics_user_idx").on(table.userId)]
);

export const learningNotes = sqliteTable(
  "learning_notes",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => learningTopics.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    plainText: text("plain_text"),
    tags: text("tags"),
    aiSummary: text("ai_summary"),
    viewCount: integer("view_count").notNull().default(0),
    mastery: text("mastery", {
      enum: ["not_started", "learning", "mastered"],
    })
      .notNull()
      .default("not_started"),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("learning_notes_topic_idx").on(table.topicId),
    index("learning_notes_user_idx").on(table.userId),
  ]
);

export const learningReviews = sqliteTable(
  "learning_reviews",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => learningTopics.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["outline", "gap", "quiz"] }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("learning_reviews_topic_idx").on(table.topicId)]
);
