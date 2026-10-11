CREATE TABLE `ingest_translation_sources` (
	`hash` char(64) NOT NULL,
	`text` text NOT NULL,
	`char_count` int unsigned NOT NULL,
	`source_locale` varchar(8),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ingest_translation_sources_hash` PRIMARY KEY(`hash`)
);
--> statement-breakpoint
CREATE TABLE `ingest_translations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_hash` char(64) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`content` text NOT NULL,
	`origin` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`problems` json,
	`provider` varchar(32),
	`model` varchar(64),
	`prompt_version` smallint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_translations_locale` UNIQUE(`source_hash`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `ingest_translations` ADD CONSTRAINT `fk_ingest_translations_source` FOREIGN KEY (`source_hash`) REFERENCES `ingest_translation_sources`(`hash`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_translations_status` ON `ingest_translations` (`status`);