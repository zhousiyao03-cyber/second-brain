CREATE TABLE `focus_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_preview` text NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `focus_devices_user_device_idx` ON `focus_devices` (`user_id`,`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `focus_devices_token_hash_idx` ON `focus_devices` (`token_hash`);