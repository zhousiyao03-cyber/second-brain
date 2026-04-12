ALTER TABLE `chat_tasks` ADD `task_type` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_tasks` ADD `structured_result` text;