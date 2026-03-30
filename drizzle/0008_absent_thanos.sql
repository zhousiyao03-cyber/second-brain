ALTER TABLE `focus_daily_summaries` RENAME COLUMN "category_breakdown" TO "tag_breakdown";--> statement-breakpoint
ALTER TABLE `activity_sessions` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `activity_sessions` ADD `browser_url` text;--> statement-breakpoint
ALTER TABLE `activity_sessions` ADD `browser_page_title` text;--> statement-breakpoint
ALTER TABLE `activity_sessions` ADD `visible_apps` text;--> statement-breakpoint
ALTER TABLE `activity_sessions` DROP COLUMN `category`;