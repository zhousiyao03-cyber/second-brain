CREATE TABLE `focus_pairing_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `focus_pairing_rate_limits_scope_key_idx` ON `focus_pairing_rate_limits` (`scope`,`key`);