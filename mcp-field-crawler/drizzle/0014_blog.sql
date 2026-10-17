CREATE TABLE `blog_posts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(120) NOT NULL,
	`title` varchar(200) NOT NULL,
	`summary` varchar(500) NOT NULL DEFAULT '',
	`body` mediumtext NOT NULL,
	`category` varchar(24) NOT NULL,
	`tags` json NOT NULL,
	`cover_url` varchar(1024),
	`author_name` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`pinned` boolean NOT NULL DEFAULT false,
	`mentions` json NOT NULL,
	`reading_minutes` smallint unsigned NOT NULL DEFAULT 1,
	`views` int unsigned NOT NULL DEFAULT 0,
	`published_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `blog_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_blog_posts_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `ix_blog_posts_status_published` ON `blog_posts` (`status`,`published_at`);