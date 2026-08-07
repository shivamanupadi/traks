ALTER TABLE `users` ADD `is_instance_owner` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the claimer is the user behind the earliest credential account.
UPDATE `users` SET `is_instance_owner` = 1 WHERE `id` = (SELECT `user_id` FROM `accounts` WHERE `provider_id` = 'credential' ORDER BY `created_at` LIMIT 1);
