DROP INDEX `loc_district_idx`;--> statement-breakpoint
DROP INDEX `loc_region_idx`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `region`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `district`;--> statement-breakpoint
ALTER TABLE `locations` DROP COLUMN `municipality`;