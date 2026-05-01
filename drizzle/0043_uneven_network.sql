PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_council_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`topic` text,
	`hard_limit_per_turn` integer DEFAULT 6 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_council_channels`("id", "user_id", "name", "topic", "hard_limit_per_turn", "created_at", "updated_at") SELECT "id", "user_id", "name", "topic", "hard_limit_per_turn", "created_at", "updated_at" FROM `council_channels`;--> statement-breakpoint
DROP TABLE `council_channels`;--> statement-breakpoint
ALTER TABLE `__new_council_channels` RENAME TO `council_channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `council_channels_user_idx` ON `council_channels` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_council_personas` (
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
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_council_personas`("id", "user_id", "name", "avatar_emoji", "system_prompt", "style_hint", "scope_kind", "scope_ref_id", "scope_tags", "is_preset", "created_at", "updated_at") SELECT "id", "user_id", "name", "avatar_emoji", "system_prompt", "style_hint", "scope_kind", "scope_ref_id", "scope_tags", "is_preset", "created_at", "updated_at" FROM `council_personas`;--> statement-breakpoint
DROP TABLE `council_personas`;--> statement-breakpoint
ALTER TABLE `__new_council_personas` RENAME TO `council_personas`;--> statement-breakpoint
CREATE INDEX `council_personas_user_idx` ON `council_personas` (`user_id`);