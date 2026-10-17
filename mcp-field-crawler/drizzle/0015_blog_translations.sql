CREATE TABLE `blog_post_translations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`locale` varchar(8) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`target_hash` char(64) NOT NULL,
	`content_hash` char(64),
	`title` varchar(400),
	`summary` varchar(1000),
	`body` mediumtext,
	`chunks` json,
	`model` varchar(64),
	`error` varchar(500),
	`attempts` tinyint unsigned NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3),
	`started_at` datetime(3),
	`translated_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `blog_post_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_blog_post_translations` UNIQUE(`post_id`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `blog_post_translations` ADD CONSTRAINT `blog_post_translations_post_id_blog_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_blog_post_translations_queue` ON `blog_post_translations` (`status`,`next_attempt_at`);