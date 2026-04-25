CREATE TABLE `daemon_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`worker_key` text NOT NULL,
	`cli_session_id` text,
	`last_used_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daemon_conversations_user_worker_idx` ON `daemon_conversations` (`user_id`,`worker_key`);