DROP TABLE IF EXISTS `snapshots`;
--> statement-breakpoint
DROP TABLE IF EXISTS `latest_values`;
--> statement-breakpoint
DROP TABLE IF EXISTS `timeseries`;
--> statement-breakpoint
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
CREATE INDEX `idx_api_data_timestamp` ON `api_data` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_api_data_source_time` ON `api_data` (`api_source`,`timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_api_data_location` ON `api_data` (`location_id`);
--> statement-breakpoint
CREATE INDEX `idx_api_data_source_type` ON `api_data` (`api_source`,`payload_type`);
