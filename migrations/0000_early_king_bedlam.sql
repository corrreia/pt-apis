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
CREATE TABLE `latest_values` (
	`adapter_id` text NOT NULL,
	`metric` text NOT NULL,
	`entity_id` text NOT NULL,
	`location_id` text,
	`value` real NOT NULL,
	`metadata` text,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`adapter_id`, `metric`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `lv_location_idx` ON `latest_values` (`location_id`);--> statement-breakpoint
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
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter_id` text NOT NULL,
	`snapshot_type` text NOT NULL,
	`location_id` text,
	`data` text NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snap_adapter_type_idx` ON `snapshots` (`adapter_id`,`snapshot_type`,`captured_at`);--> statement-breakpoint
CREATE INDEX `snap_location_idx` ON `snapshots` (`location_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `timeseries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter_id` text NOT NULL,
	`metric` text NOT NULL,
	`entity_id` text NOT NULL,
	`location_id` text,
	`value` real NOT NULL,
	`metadata` text,
	`observed_at` integer NOT NULL,
	`ingested_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ts_adapter_metric_entity_idx` ON `timeseries` (`adapter_id`,`metric`,`entity_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `ts_observed_at_idx` ON `timeseries` (`observed_at`);--> statement-breakpoint
CREATE INDEX `ts_location_idx` ON `timeseries` (`location_id`);