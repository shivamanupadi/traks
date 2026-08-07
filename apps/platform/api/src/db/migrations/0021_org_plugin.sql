DROP TABLE `workspace_invitations`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `active_organization_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `slug` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `logo` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `metadata` text;--> statement-breakpoint
-- Backfill before the unique index: pre-slug rows all carry the '' default.
UPDATE `workspaces` SET `slug` = `id` WHERE `slug` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_idx` ON `workspaces` (`slug`);