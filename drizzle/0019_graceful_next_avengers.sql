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
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_tasks_status_created_idx` ON `chat_tasks` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `daemon_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`delta` text,
	`created_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `chat_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daemon_chat_messages_task_seq_idx` ON `daemon_chat_messages` (`task_id`,`seq`);--> statement-breakpoint
CREATE TABLE `daemon_heartbeats` (
	`kind` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	`version` text
);
