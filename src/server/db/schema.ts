import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"), // JSON, Tiptap format
  plainText: text("plain_text"), // for search & vectorization
  type: text("type", { enum: ["note", "journal", "summary"] }).default("note"),
  tags: text("tags"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  url: text("url"),
  title: text("title"),
  content: text("content"),
  summary: text("summary"),
  tags: text("tags"), // JSON array
  source: text("source", { enum: ["url", "text", "lark"] }).default("url"),
  status: text("status", { enum: ["pending", "processed", "failed"] }).default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).default("medium"),
  status: text("status", { enum: ["todo", "in_progress", "done"] }).default("todo"),
  category: text("category"),
  dueDate: integer("due_date", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  sources: text("sources"), // JSON, referenced doc IDs
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: text("nodes"), // JSON, workflow node definitions
  edges: text("edges"), // JSON, node connections
  status: text("status", { enum: ["draft", "active"] }).default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const learningPaths = sqliteTable("learning_paths", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category", {
    enum: ["backend", "database", "devops", "ai", "system-design"],
  }),
  lessons: text("lessons"), // JSON, lesson list & order
  progress: real("progress").default(0), // 0-100
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const learningLessons = sqliteTable("learning_lessons", {
  id: text("id").primaryKey(),
  pathId: text("path_id").references(() => learningPaths.id),
  title: text("title").notNull(),
  content: text("content"), // AI generated lesson content
  quiz: text("quiz"), // JSON, exercises
  orderIndex: integer("order_index"),
  status: text("status", { enum: ["locked", "available", "completed"] }).default("locked"),
  notes: text("notes"), // user study notes
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").references(() => workflows.id),
  status: text("status", { enum: ["running", "completed", "failed"] }).default("running"),
  results: text("results"), // JSON, per-node results
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});
