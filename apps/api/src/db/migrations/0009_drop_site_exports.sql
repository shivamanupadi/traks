DROP INDEX `sites_export_token_idx`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `export_enabled`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `export_token`;