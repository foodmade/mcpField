CREATE TABLE `ingest_translation_failures` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_hash` char(64) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`failures` smallint unsigned NOT NULL DEFAULT 1,
	`reason` varchar(255),
	`model` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_translation_failures_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_translation_failures` UNIQUE(`source_hash`,`locale`)
);
