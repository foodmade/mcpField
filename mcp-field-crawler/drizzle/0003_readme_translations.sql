CREATE TABLE `ingest_readme_translations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`readme_hash` char(64) NOT NULL,
	`content` mediumtext NOT NULL,
	`chunk_count` smallint unsigned NOT NULL,
	`translated_chunks` smallint unsigned NOT NULL,
	`models` varchar(255),
	`prompt_version` smallint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`review_chunks` smallint unsigned NOT NULL DEFAULT 0,
	`license` varchar(64),
	`translated_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_readme_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_readme_translations` UNIQUE(`source_id`,`kind`,`external_id`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `ingest_translation_sources` MODIFY COLUMN `text` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `ingest_translations` MODIFY COLUMN `content` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `ingest_readme_translations` ADD CONSTRAINT `ingest_readme_translations_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_readme_translations_status` ON `ingest_readme_translations` (`status`);