CREATE TABLE `media_assets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`source_url_hash` char(64) NOT NULL,
	`purpose` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`storage_key` varchar(255),
	`public_url` varchar(512),
	`content_hash` char(64),
	`mime` varchar(64),
	`width` smallint unsigned,
	`height` smallint unsigned,
	`bytes` int unsigned,
	`original_mime` varchar(128),
	`original_bytes` int unsigned,
	`http_status` smallint unsigned,
	`error` varchar(512),
	`attempts` smallint unsigned NOT NULL DEFAULT 0,
	`last_attempt_at` datetime(3),
	`next_retry_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `media_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_media_assets_source` UNIQUE(`source_url_hash`)
);
--> statement-breakpoint
CREATE INDEX `ix_media_assets_status` ON `media_assets` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `ix_media_assets_content` ON `media_assets` (`content_hash`);