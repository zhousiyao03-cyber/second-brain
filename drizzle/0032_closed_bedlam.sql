CREATE TABLE `ops_job_heartbeats` (
	`job_name` text PRIMARY KEY NOT NULL,
	`last_status` text NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_message` text,
	`updated_at` integer NOT NULL
);
