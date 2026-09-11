CREATE TABLE `security_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_access_audit_site_idx` ON `security_access_audit` (`site_id`);--> statement-breakpoint
CREATE TABLE `security_ip_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`ip_raw` text NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`isp` text DEFAULT '' NOT NULL,
	`ts` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_ip_logs_site_ts_idx` ON `security_ip_logs` (`site_id`,`ts`);--> statement-breakpoint
CREATE INDEX `security_ip_logs_expires_idx` ON `security_ip_logs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `security_site_settings` (
	`site_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
