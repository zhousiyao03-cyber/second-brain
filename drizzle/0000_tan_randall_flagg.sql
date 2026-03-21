CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text,
	`title` text,
	`content` text,
	`summary` text,
	`tags` text,
	`source` text DEFAULT 'url',
	`status` text DEFAULT 'pending',
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `learning_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`path_id` text,
	`title` text NOT NULL,
	`content` text,
	`quiz` text,
	`order_index` integer,
	`status` text DEFAULT 'locked',
	`notes` text,
	`completed_at` integer,
	FOREIGN KEY (`path_id`) REFERENCES `learning_paths`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `learning_paths` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`lessons` text,
	`progress` real DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`plain_text` text,
	`type` text DEFAULT 'note',
	`tags` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium',
	`status` text DEFAULT 'todo',
	`category` text,
	`due_date` integer,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text,
	`status` text DEFAULT 'running',
	`results` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`nodes` text,
	`edges` text,
	`status` text DEFAULT 'draft',
	`created_at` integer,
	`updated_at` integer
);
