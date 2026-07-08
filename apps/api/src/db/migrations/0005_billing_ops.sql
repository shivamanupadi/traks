CREATE TABLE `ops_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
ALTER TABLE `users` ADD `dodo_customer_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `dodo_subscription_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `weekly_report` integer DEFAULT true NOT NULL;