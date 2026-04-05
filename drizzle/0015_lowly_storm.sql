CREATE TABLE `analysis_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`tool` text,
	`summary` text,
	`created_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `analysis_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
