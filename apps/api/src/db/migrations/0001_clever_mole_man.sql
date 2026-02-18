CREATE TABLE `archive_state` (
	`site_id` text PRIMARY KEY NOT NULL,
	`last_archived_date` text,
	`last_r2_archived_date` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`updated_at` integer,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_devices_site_date_idx` ON `daily_devices` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`total_value` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_events_site_date_idx` ON `daily_events` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_locations_site_date_idx` ON `daily_locations` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`pathname` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_pages_site_date_idx` ON `daily_pages` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_referrers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_referrers_site_date_idx` ON `daily_referrers` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_stats_site_date_idx` ON `daily_stats` (`site_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_utm` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_utm_site_date_idx` ON `daily_utm` (`site_id`,`date`);