import { sqliteTable, text, integer, real, blob, uniqueIndex, index } from "drizzle-orm/sqlite-core";


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

// ── Folders (hierarchical) ─────────────────────────
export const folders = sqliteTable(
  "folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: text("parent_id"), // self-reference for nesting
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("folders_user_idx").on(table.userId),
    index("folders_parent_idx").on(table.parentId),
  ]
);

export const notes = sqliteTable(
  "notes",
  {
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
    folder: text("folder"), // legacy flat grouping (kept for compat)
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    shareToken: text("share_token").unique(),
    sharedAt: integer("shared_at", { mode: "timestamp" }),
    /**
     * 单调递增的内容版本号。每次经过 notes.update / notes.appendBlocks
     * 这两个"用户内容写入"路径时 +1。用途见 docs/learn-backend/phase-b1.md
     * B1-3 段落：
     *   1. 为未来的"编辑历史"功能留版本号入口
     *   2. 为 B9 事件溯源的 event id 做铺垫
     *   3. 故意不做 CAS 乐观锁 — 详细原因见同一份文档
     * enableShare / disableShare / 系统性 title normalize / folder 批量迁移
     * 都不递增这一列（它们不是"内容变更"）。
     */
    version: integer("version").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("notes_user_idx").on(table.userId),
    index("notes_user_folder_idx").on(table.userId, table.folder),
    index("notes_folder_id_idx").on(table.folderId),
    // B1-5: covers notes.list's default ORDER BY updated_at DESC,
    // removing the "TEMP B-TREE FOR ORDER BY" file-sort step.
    // Rule: equality-first (user_id), range/sort-last (updated_at).
    index("notes_user_updated_idx").on(table.userId, table.updatedAt),
  ]
);

// ── Note Links (bidirectional wiki-links) ──────────
export const noteLinks = sqliteTable(
  "note_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceNoteId: text("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: text("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetTitle: text("target_title").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("note_links_source_idx").on(table.sourceNoteId),
    index("note_links_target_idx").on(table.targetNoteId),
    uniqueIndex("note_links_pair_idx").on(table.sourceNoteId, table.targetNoteId),
  ]
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
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
  },
  (table) => [
    index("bookmarks_user_idx").on(table.userId),
    // B1-5: covers bookmarks.list's default ORDER BY created_at DESC.
    index("bookmarks_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const todos = sqliteTable(
  "todos",
  {
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
  },
  (table) => [
    index("todos_user_idx").on(table.userId),
    index("todos_user_duedate_status_idx").on(table.userId, table.dueDate, table.status),
    // B1-5: covers todos.list's default ORDER BY created_at DESC and
    // dashboard.pendingTodos which sorts on the same column.
    index("todos_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    sources: text("sources"), // JSON, referenced doc IDs
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("chat_messages_user_idx").on(table.userId)]
);

export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    // Nullable for backward compat with rows written before the security
    // rollout; a one-shot backfill script copies userId from the owning
    // note/bookmark. New writes always set this.
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
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
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date()
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date()
    ),
  },
  (table) => [
    index("knowledge_chunks_user_id_idx").on(table.userId),
    index("knowledge_chunks_source_idx").on(table.sourceId),
  ]
);

export const knowledgeChunkEmbeddings = sqliteTable("knowledge_chunk_embeddings", {
  chunkId: text("chunk_id")
    .primaryKey()
    .references(() => knowledgeChunks.id),
  model: text("model").notNull(),
  dims: integer("dims").notNull(),
  vector: blob("vector", { mode: "buffer" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const knowledgeIndexJobs = sqliteTable(
  "knowledge_index_jobs",
  {
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
  },
  (table) => [
    index("knowledge_index_jobs_source_idx").on(table.sourceId),
    index("knowledge_index_jobs_status_idx").on(table.status),
    // B1-5: covers the claimNextJob hot path — WHERE status='pending'
    // AND queued_at <= ? ORDER BY queued_at ASC. Equality-first
    // (status), range+sort-last (queued_at). Replaces the TEMP B-TREE
    // FOR ORDER BY step that showed up in the B1-4 audit.
    index("knowledge_index_jobs_status_queued_idx").on(
      table.status,
      table.queuedAt
    ),
  ]
);

export const workflows = sqliteTable(
  "workflows",
  {
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
  },
  (table) => [index("workflows_user_idx").on(table.userId)]
);

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

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").references(() => workflows.id),
    status: text("status", { enum: ["running", "completed", "failed"] }).default("running"),
    results: text("results"), // JSON, per-node results
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [index("workflow_runs_workflow_idx").on(table.workflowId)]
);

export const tokenUsageEntries = sqliteTable(
  "token_usage_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["codex", "claude-code", "openai-api", "other"] }).notNull(),
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
  },
  (table) => [index("token_usage_entries_user_idx").on(table.userId, table.usageAt)]
);

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    date: text("date").notNull(), // "YYYY-MM-DD"
    provider: text("provider").notNull(), // "claude-code" | "codex"
    model: text("model").notNull().default(""),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("usage_records_date_provider_model_idx").on(
      table.date,
      table.provider,
      table.model,
    ),
  ],
);

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
    tags: text("tags"),
    browserUrl: text("browser_url"),
    browserPageTitle: text("browser_page_title"),
    browserHost: text("browser_host"),
    browserPath: text("browser_path"),
    browserSearchQuery: text("browser_search_query"),
    browserSurfaceType: text("browser_surface_type"),
    visibleApps: text("visible_apps"),
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
    index("activity_sessions_user_started_idx").on(
      table.userId,
      table.startedAt
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
    tagBreakdown: text("tag_breakdown"),
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

export const portfolioHoldings = sqliteTable(
  "portfolio_holdings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type", { enum: ["stock", "crypto"] }).notNull(),
    quantity: real("quantity").notNull(),
    costPrice: real("cost_price").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("portfolio_holdings_user_idx").on(table.userId),
    index("portfolio_holdings_user_symbol_idx").on(table.userId, table.symbol),
  ]
);

export const portfolioNews = sqliteTable(
  "portfolio_news",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    summary: text("summary").notNull(),
    sentiment: text("sentiment", { enum: ["bullish", "bearish", "neutral"] }).notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("portfolio_news_user_idx").on(table.userId),
    index("portfolio_news_user_symbol_idx").on(table.userId, table.symbol),
  ]
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

// ── Open Source Projects ──────────────────────────

export const osProjects = sqliteTable(
  "os_projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoUrl: text("repo_url"),
    description: text("description"),
    language: text("language"),
    aiSummary: text("ai_summary"),
    // Source-code analysis fields
    analysisStatus: text("analysis_status"), // null | pending | analyzing | completed | failed
    analysisError: text("analysis_error"),
    // Snapshot of the repo at the time of the most recent successful analysis
    analysisCommit: text("analysis_commit"), // git rev-parse HEAD (full sha)
    analysisCommitDate: integer("analysis_commit_date", { mode: "timestamp" }), // commit author/committer date
    analysisStartedAt: integer("analysis_started_at", { mode: "timestamp" }),
    analysisFinishedAt: integer("analysis_finished_at", { mode: "timestamp" }),
    starsCount: integer("stars_count"),
    trendingDate: text("trending_date"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("os_projects_user_idx").on(table.userId)]
);

/**
 * User-customizable prompts for source code analysis.
 *
 * One row per (userId, kind). Falls back to baked-in defaults from
 * `src/server/ai/default-analysis-prompts.ts` when no row exists.
 */
export const analysisPrompts = sqliteTable(
  "analysis_prompts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["analysis", "followup"] }).notNull(),
    content: text("content").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    userKindIdx: uniqueIndex("analysis_prompts_user_kind_idx").on(table.userId, table.kind),
  })
);

export const osProjectNotes = sqliteTable(
  "os_project_notes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => osProjects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    plainText: text("plain_text"),
    tags: text("tags"),
    shareToken: text("share_token").unique(),
    sharedAt: integer("shared_at", { mode: "timestamp" }),
    noteType: text("note_type").default("manual"), // manual | analysis | followup
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("os_project_notes_project_idx").on(table.projectId)]
);

export const analysisTasks = sqliteTable(
  "analysis_tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => osProjects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskType: text("task_type", { enum: ["analysis", "followup"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    provider: text("provider").notNull().default("claude"), // claude | codex | ...
    repoUrl: text("repo_url").notNull(),
    question: text("question"),
    originalAnalysis: text("original_analysis"),
    result: text("result"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("analysis_tasks_project_idx").on(table.projectId),
    index("analysis_tasks_status_idx").on(table.status, table.createdAt),
  ]
);

export const analysisMessages = sqliteTable(
  "analysis_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text("task_id")
      .notNull()
      .references(() => analysisTasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type", { enum: ["tool_use", "tool_result", "text", "error"] }).notNull(),
    tool: text("tool"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("analysis_messages_task_idx").on(table.taskId, table.seq)]
);

// ── Ask AI Daemon Queue ────────────────────────────
// daemonChatMessages is prefixed to avoid colliding with the legacy v1
// `chatMessages` conversation table at line 94 above. Different shape,
// different purpose — both are retained.

export const chatTasks = sqliteTable(
  "chat_tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    taskType: text("task_type", { enum: ["chat", "structured"] })
      .notNull()
      .default("chat"),
    sourceScope: text("source_scope").notNull().default("all"), // "all" | "notes" | "bookmarks" | "direct" — see src/lib/ask-ai.ts#ASK_AI_SOURCE_SCOPES
    messages: text("messages").notNull(), // JSON-encoded ModelMessage[]
    systemPrompt: text("system_prompt").notNull(),
    model: text("model").notNull().default("opus"), // Claude CLI model alias: "opus" | "sonnet" | "haiku" (or full ID)
    totalText: text("total_text"),
    structuredResult: text("structured_result"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    statusCreatedAtIdx: index("chat_tasks_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id
    ),
  })
);

export const daemonChatMessages = sqliteTable(
  "daemon_chat_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text("task_id")
      .notNull()
      .references(() => chatTasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type", { enum: ["text_delta", "text_final", "error"] }).notNull(),
    delta: text("delta"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    taskSeqIdx: uniqueIndex("daemon_chat_messages_task_seq_idx").on(table.taskId, table.seq),
  })
);

export const daemonHeartbeats = sqliteTable("daemon_heartbeats", {
  kind: text("kind").primaryKey(), // "chat" | "analysis" | "usage"
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  version: text("version"),
});
