CREATE TABLE `activity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_device_id` text NOT NULL,
	`source_session_id` text NOT NULL,
	`app_name` text NOT NULL,
	`window_title` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`duration_secs` integer NOT NULL,
	`category` text,
	`ai_summary` text,
	`ingestion_status` text DEFAULT 'pending' NOT NULL,
	`ingested_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_sessions_user_device_source_idx` ON `activity_sessions` (`user_id`,`source_device_id`,`source_session_id`);--> statement-breakpoint
CREATE TABLE `focus_daily_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`timezone` text NOT NULL,
	`total_focus_secs` integer DEFAULT 0 NOT NULL,
	`category_breakdown` text,
	`ai_analysis` text,
	`source_updated_at` integer,
	`generated_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `focus_daily_user_date_idx` ON `focus_daily_summaries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_credentials_email_unique` ON `user_credentials` (`email`);