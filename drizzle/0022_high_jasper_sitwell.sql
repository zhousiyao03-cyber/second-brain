ALTER TABLE `knowledge_chunks` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `knowledge_chunks_user_id_idx` ON `knowledge_chunks` (`user_id`);