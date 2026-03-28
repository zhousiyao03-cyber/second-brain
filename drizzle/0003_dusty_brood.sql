CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_user_date_idx` ON `ai_usage` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `learning_paths` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `todos` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `token_usage_entries` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `workflows` ADD `user_id` text NOT NULL REFERENCES users(id);