CREATE TABLE `ingest_classifications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`primary_slug` varchar(64) NOT NULL,
	`secondary` json NOT NULL,
	`confidence` smallint unsigned NOT NULL,
	`taxonomy_version` smallint unsigned NOT NULL,
	`prompt_version` smallint unsigned NOT NULL,
	`input_hash` char(64) NOT NULL,
	`model` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`classified_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_classifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_classifications_entity` UNIQUE(`source_id`,`kind`,`external_id`)
);
--> statement-breakpoint
ALTER TABLE `ingest_classifications` ADD CONSTRAINT `ingest_classifications_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_classifications_primary` ON `ingest_classifications` (`kind`,`primary_slug`);