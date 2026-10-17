CREATE TABLE `admin_settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `blog_posts` DROP COLUMN `category`;