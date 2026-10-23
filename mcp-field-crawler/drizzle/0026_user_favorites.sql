CREATE TABLE `user_favorites` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`name` varchar(255) NOT NULL,
	`favorited_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_favorites` UNIQUE(`user_id`,`kind`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `ix_user_favorites_user_time` ON `user_favorites` (`user_id`,`favorited_at`);