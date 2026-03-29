CREATE TABLE `focus_device_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_preview` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`paired_device_id` text,
	`paired_device_name` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `focus_device_pairings_code_hash_idx` ON `focus_device_pairings` (`code_hash`);