CREATE TABLE `deploy_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`account_id` text,
	`instance_name` text,
	`api_url` text,
	`collect_url` text,
	`error` text,
	`steps` text,
	`created_at` integer,
	`updated_at` integer
);
