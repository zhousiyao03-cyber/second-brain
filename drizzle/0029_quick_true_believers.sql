CREATE TABLE `cli_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text DEFAULT 'CLI Daemon' NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cli_tokens_hash_idx` ON `cli_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `cli_tokens_user_idx` ON `cli_tokens` (`user_id`);