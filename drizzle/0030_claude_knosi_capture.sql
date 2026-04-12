CREATE TABLE `oauth_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`refresh_token_id` text,
	`token_hash` text NOT NULL,
	`token_preview` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_token_id`) REFERENCES `oauth_refresh_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_tokens_token_hash_idx` ON `oauth_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_user_client_idx` ON `oauth_access_tokens` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_refresh_token_idx` ON `oauth_access_tokens` (`refresh_token_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_expires_at_idx` ON `oauth_access_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_preview` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer,
	`consumed_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_codes_code_hash_idx` ON `oauth_authorization_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_user_client_idx` ON `oauth_authorization_codes` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_expires_at_idx` ON `oauth_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_preview` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_tokens_token_hash_idx` ON `oauth_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_user_client_idx` ON `oauth_refresh_tokens` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_expires_at_idx` ON `oauth_refresh_tokens` (`expires_at`);