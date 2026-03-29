import { sqliteTable, text, integer, real, blob, uniqueIndex } from "drizzle-orm/sqlite-core";
import { TOKEN_USAGE_PROVIDERS } from "@/lib/token-usage";

// ── Auth.js tables ──────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  image: text("image"),
});

export const accounts = sqliteTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const userCredentials = sqliteTable("user_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content"), // JSON, Tiptap format
  plainText: text("plain_text"), // for search & vectorization
  type: text("type", { enum: ["note", "journal", "summary"] }).default("note"),
  icon: text("icon"),
  cover: text("cover"),
  tags: text("tags"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  sources: text("sources"), // JSON, referenced doc IDs
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: text("id").primaryKey(),
  sourceType: text("source_type", { enum: ["note", "bookmark"] }).notNull(),
  sourceId: text("source_id").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp" }),
  chunkIndex: integer("chunk_index").notNull(),
  sectionPath: text("section_path"), // JSON array
  blockType: text("block_type"),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  tokenCount: integer("token_count"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const knowledgeChunkEmbeddings = sqliteTable("knowledge_chunk_embeddings", {
  chunkId: text("chunk_id")
    .primaryKey()
    .references(() => knowledgeChunks.id),
  model: text("model").notNull(),
  dims: integer("dims").notNull(),
  vector: blob("vector", { mode: "buffer" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const knowledgeIndexJobs = sqliteTable("knowledge_index_jobs", {
  id: text("id").primaryKey(),
  sourceType: text("source_type", { enum: ["note", "bookmark"] }).notNull(),
  sourceId: text("source_id").notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["pending", "running", "done", "failed"] })
    .notNull()
    .default("pending"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(1),
  queuedAt: integer("queued_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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

export const tokenUsageEntries = sqliteTable("token_usage_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: TOKEN_USAGE_PROVIDERS }).notNull(),
  model: text("model"),
  totalTokens: integer("total_tokens").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  cachedTokens: integer("cached_tokens").default(0),
  notes: text("notes"),
  source: text("source", { enum: ["manual", "import"] }).notNull().default("manual"),
  usageAt: integer("usage_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const activitySessions = sqliteTable(
  "activity_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceDeviceId: text("source_device_id").notNull(),
    sourceSessionId: text("source_session_id").notNull(),
    appName: text("app_name").notNull(),
    windowTitle: text("window_title"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp" }).notNull(),
    durationSecs: integer("duration_secs").notNull(),
    category: text("category"),
    aiSummary: text("ai_summary"),
    ingestionStatus: text("ingestion_status", {
      enum: ["pending", "processed", "failed"],
    })
      .notNull()
      .default("pending"),
    ingestedAt: integer("ingested_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("activity_sessions_user_device_source_idx").on(
      table.userId,
      table.sourceDeviceId,
      table.sourceSessionId
    ),
  ]
);

export const focusDailySummaries = sqliteTable(
  "focus_daily_summaries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    timezone: text("timezone").notNull(),
    totalFocusSecs: integer("total_focus_secs").notNull().default(0),
    categoryBreakdown: text("category_breakdown"),
    aiAnalysis: text("ai_analysis"),
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp" }),
    generatedAt: integer("generated_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("focus_daily_user_date_idx").on(table.userId, table.date)]
);

export const focusDevices = sqliteTable(
  "focus_devices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPreview: text("token_preview").notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("focus_devices_user_device_idx").on(table.userId, table.deviceId),
    uniqueIndex("focus_devices_token_hash_idx").on(table.tokenHash),
  ]
);

export const focusDevicePairings = sqliteTable(
  "focus_device_pairings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    codePreview: text("code_preview").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    pairedDeviceId: text("paired_device_id"),
    pairedDeviceName: text("paired_device_name"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("focus_device_pairings_code_hash_idx").on(table.codeHash),
  ]
);

export const focusPairingRateLimits = sqliteTable(
  "focus_pairing_rate_limits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    count: integer("count").notNull().default(0),
    windowStart: integer("window_start", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("focus_pairing_rate_limits_scope_key_idx").on(table.scope, table.key)]
);

export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // 'YYYY-MM-DD'
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("ai_usage_user_date_idx").on(table.userId, table.date),
  ]
);
