DROP INDEX `usage_records_date_provider_model_idx`;--> statement-breakpoint
ALTER TABLE `usage_records` ADD `user_id` text NOT NULL REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_records_user_date_provider_model_idx` ON `usage_records` (`user_id`,`date`,`provider`,`model`);