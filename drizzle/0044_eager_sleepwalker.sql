CREATE TABLE `drifter_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`summary` text NOT NULL,
	`source_message_id` text,
	`importance` integer DEFAULT 3 NOT NULL,
	`created_at` integer NOT NULL,
	`last_referenced_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `drifter_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drifter_memories_user_idx` ON `drifter_memories` (`user_id`,`importance`);--> statement-breakpoint
CREATE TABLE `drifter_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`emotion` text,
	`status` text DEFAULT 'complete' NOT NULL,
	`hooks` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `drifter_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drifter_messages_session_idx` ON `drifter_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `drifter_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day_number` integer NOT NULL,
	`weather` text NOT NULL,
	`time_of_day` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drifter_sessions_user_idx` ON `drifter_sessions` (`user_id`,`started_at`);