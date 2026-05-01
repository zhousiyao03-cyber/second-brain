CREATE TABLE `council_channel_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`role` text NOT NULL,
	`persona_id` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`turn_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `council_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `council_personas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `council_messages_channel_idx` ON `council_channel_messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `council_messages_turn_idx` ON `council_channel_messages` (`turn_id`);--> statement-breakpoint
CREATE TABLE `council_channel_personas` (
	`channel_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `persona_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `council_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `council_personas`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `council_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`topic` text,
	`hard_limit_per_turn` integer DEFAULT 6 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `council_channels_user_idx` ON `council_channels` (`user_id`);--> statement-breakpoint
CREATE TABLE `council_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`avatar_emoji` text,
	`system_prompt` text NOT NULL,
	`style_hint` text,
	`scope_kind` text NOT NULL,
	`scope_ref_id` text,
	`scope_tags` text,
	`is_preset` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `council_personas_user_idx` ON `council_personas` (`user_id`);