-- Ask AI Claude Code Daemon schema rollout
-- Date: 2026-04-09
-- Target: production Turso DB
--
-- This is a pure additive migration: 3 new tables + 2 new indexes, no
-- changes to any existing table. Safe to run against production.
--
-- Consolidates drizzle migrations 0019 and 0020 into a single idempotent
-- rollout (0019 originally created the status index as UNIQUE, 0020 fixed
-- it to a regular index — this script just creates the final non-unique
-- form directly, skipping the intermediate state).
--
-- Apply with:
--   turso db shell <your-db-name> < scripts/db/2026-04-09-chat-daemon-schema.sql
--
-- Then verify with the queries at the bottom of this file.

CREATE TABLE `chat_tasks` (
    `id` text PRIMARY KEY NOT NULL,
    `user_id` text NOT NULL,
    `status` text DEFAULT 'queued' NOT NULL,
    `source_scope` text DEFAULT 'all' NOT NULL,
    `messages` text NOT NULL,
    `system_prompt` text NOT NULL,
    `model` text DEFAULT 'opus' NOT NULL,
    `total_text` text,
    `error` text,
    `created_at` integer,
    `started_at` integer,
    `completed_at` integer,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `chat_tasks_status_created_idx` ON `chat_tasks` (`status`,`created_at`,`id`);

CREATE TABLE `daemon_chat_messages` (
    `id` text PRIMARY KEY NOT NULL,
    `task_id` text NOT NULL,
    `seq` integer NOT NULL,
    `type` text NOT NULL,
    `delta` text,
    `created_at` integer,
    FOREIGN KEY (`task_id`) REFERENCES `chat_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `daemon_chat_messages_task_seq_idx` ON `daemon_chat_messages` (`task_id`,`seq`);

CREATE TABLE `daemon_heartbeats` (
    `kind` text PRIMARY KEY NOT NULL,
    `last_seen_at` integer NOT NULL,
    `version` text
);

-- ─── Verification queries (run after apply) ────────────────────────
-- These are commented out so the script only applies DDL. Paste them
-- into the turso shell manually after the CREATEs succeed.
--
-- Confirm the three new tables exist:
--   SELECT name FROM sqlite_master WHERE type='table'
--     AND name IN ('chat_tasks','daemon_chat_messages','daemon_heartbeats')
--     ORDER BY name;
--   -- Expected 3 rows: chat_tasks, daemon_chat_messages, daemon_heartbeats
--
-- Confirm the two new indexes exist:
--   SELECT name FROM sqlite_master WHERE type='index'
--     AND name IN ('chat_tasks_status_created_idx','daemon_chat_messages_task_seq_idx')
--     ORDER BY name;
--   -- Expected 2 rows
--
-- Confirm the status index is NOT unique:
--   SELECT sql FROM sqlite_master WHERE name='chat_tasks_status_created_idx';
--   -- Expected: "CREATE INDEX ..." (no "UNIQUE")
--
-- Confirm the legacy chat_messages table is NOT affected:
--   SELECT COUNT(*) FROM chat_messages;
--   -- Should still work and match pre-rollout row count
