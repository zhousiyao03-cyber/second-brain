ALTER TABLE `learning_notes` ADD `view_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `learning_notes` ADD `mastery` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `learning_notes` ADD `last_viewed_at` integer;