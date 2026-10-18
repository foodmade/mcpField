CREATE TABLE `admin_site_users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255),
	`name` varchar(100),
	`avatar_url` varchar(512),
	`providers` varchar(64) NOT NULL DEFAULT '',
	`github_login` varchar(100),
	`locale` varchar(8),
	`email_confirmed_at` datetime(3),
	`banned_until` datetime(3),
	`registered_at` datetime(3) NOT NULL,
	`last_sign_in_at` datetime(3),
	`synced_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_site_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_admin_site_users_registered` ON `admin_site_users` (`registered_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_site_users_sign_in` ON `admin_site_users` (`last_sign_in_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_site_users_email` ON `admin_site_users` (`email`);