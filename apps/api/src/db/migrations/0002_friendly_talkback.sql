CREATE INDEX `daily_devices_site_type_date_idx` ON `daily_devices` (`site_id`,`type`,`date`);--> statement-breakpoint
CREATE INDEX `daily_locations_site_type_date_idx` ON `daily_locations` (`site_id`,`type`,`date`);--> statement-breakpoint
CREATE INDEX `daily_utm_site_type_date_idx` ON `daily_utm` (`site_id`,`type`,`date`);