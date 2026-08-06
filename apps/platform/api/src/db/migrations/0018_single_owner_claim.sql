--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounts_single_credential_idx` ON `accounts` (`provider_id`) WHERE `provider_id` = 'credential';
