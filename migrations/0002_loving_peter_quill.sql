DROP TABLE IF EXISTS `ingest_log`;--> statement-breakpoint
CREATE TABLE `ingest_log` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter_id` text NOT NULL,
	`status` text NOT NULL,
	`records_count` integer DEFAULT 0,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);--> statement-breakpoint
CREATE INDEX `log_adapter_status_idx` ON `ingest_log` (`adapter_id`,`status`);
