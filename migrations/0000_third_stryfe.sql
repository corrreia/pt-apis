CREATE TABLE `api_data` (
	`id` text PRIMARY KEY NOT NULL,
	`api_source` text NOT NULL,
	`payload_type` text NOT NULL,
	`timestamp` integer NOT NULL,
	`location_id` text,
	`payload` text NOT NULL,
	`tags` text,
	`scraped_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_api_data_timestamp` ON `api_data` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_api_data_source_time` ON `api_data` (`api_source`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_api_data_location` ON `api_data` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_api_data_source_type` ON `api_data` (`api_source`,`payload_type`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`r2_key` text NOT NULL,
	`location_id` text,
	`size_bytes` integer,
	`metadata` text,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_adapter_idx` ON `documents` (`adapter_id`);--> statement-breakpoint
CREATE INDEX `doc_location_idx` ON `documents` (`location_id`);--> statement-breakpoint
CREATE TABLE `ingest_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter_id` text NOT NULL,
	`status` text NOT NULL,
	`records_count` integer DEFAULT 0,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `log_adapter_status_idx` ON `ingest_log` (`adapter_id`,`status`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`type` text NOT NULL,
	`region` text,
	`district` text,
	`municipality` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `loc_type_idx` ON `locations` (`type`);--> statement-breakpoint
CREATE INDEX `loc_district_idx` ON `locations` (`district`);--> statement-breakpoint
CREATE INDEX `loc_region_idx` ON `locations` (`region`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source_url` text,
	`data_types` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL
);
