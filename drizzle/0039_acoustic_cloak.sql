-- Make daemon_heartbeats per-user (composite PK on user_id + kind).
-- The pre-existing rows have no user_id (the old PK was just `kind`),
-- so they cannot be migrated 1:1; we drop them and let live daemons
-- repopulate on their next heartbeat (60s cadence).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `daemon_heartbeats`;--> statement-breakpoint
CREATE TABLE `daemon_heartbeats` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`version` text,
	PRIMARY KEY(`user_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `daemon_heartbeats_kind_last_seen_idx` ON `daemon_heartbeats` (`kind`,`last_seen_at`);
