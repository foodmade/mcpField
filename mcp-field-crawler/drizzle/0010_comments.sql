CREATE TABLE `comment_reactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`reaction` varchar(16) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comment_reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comment_reactions` UNIQUE(`comment_id`,`user_id`,`reaction`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`parent_id` bigint unsigned,
	`user_id` varchar(36) NOT NULL,
	`author_name` varchar(100) NOT NULL,
	`author_avatar` varchar(512),
	`body` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `comment_reactions` ADD CONSTRAINT `comment_reactions_comment_id_comments_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_parent_id_comments_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_comments_target` ON `comments` (`kind`,`slug`,`parent_id`,`id`);--> statement-breakpoint
CREATE INDEX `ix_comments_parent` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `ix_comments_user_created` ON `comments` (`user_id`,`created_at`);