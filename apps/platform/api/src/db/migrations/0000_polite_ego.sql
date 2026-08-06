CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text DEFAULT 'Default' NOT NULL,
	`key` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_idx` ON `api_keys` (`key`);--> statement-breakpoint
CREATE INDEX `api_keys_site_id_idx` ON `api_keys` (`site_id`);--> statement-breakpoint
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`public` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sites_user_id_idx` ON `sites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sites_domain_idx` ON `sites` (`domain`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`image_url` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`site_limit` integer DEFAULT 5 NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
