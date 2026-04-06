ALTER TABLE `notes` ADD `share_token` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `shared_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `notes_share_token_unique` ON `notes` (`share_token`);