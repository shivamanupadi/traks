ALTER TABLE `sites` ADD `export_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `export_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sites_export_token_idx` ON `sites` (`export_token`);