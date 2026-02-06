-- Wipe existing api_data (dev data, will be re-ingested with proper hashes)
DELETE FROM `api_data`;--> statement-breakpoint
ALTER TABLE `api_data` ADD `content_hash` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_data_dedup` ON `api_data` (`api_source`,`payload_type`,`content_hash`);
