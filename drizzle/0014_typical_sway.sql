CREATE TABLE `analysis_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`task_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`repo_url` text NOT NULL,
	`question` text,
	`original_analysis` text,
	`result` text,
	`error` text,
	`created_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `os_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
