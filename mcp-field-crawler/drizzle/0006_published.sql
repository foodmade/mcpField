CREATE TABLE `ingest_published` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`identity_key` varchar(255) NOT NULL,
	`record_id` bigint unsigned NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`sources` varchar(255) NOT NULL,
	`member_count` smallint unsigned NOT NULL,
	`draft_hash` char(64) NOT NULL,
	`draft` json NOT NULL,
	`mapped_at` datetime(3) NOT NULL,
	`published_at` datetime(3) NOT NULL,
	CONSTRAINT `ingest_published_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_published_slug` UNIQUE(`kind`,`slug`),
	CONSTRAINT `uq_ingest_published_identity` UNIQUE(`kind`,`identity_key`),
	CONSTRAINT `uq_ingest_published_primary` UNIQUE(`source_id`,`kind`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_published_slugs` (
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`published_id` bigint unsigned NOT NULL,
	CONSTRAINT `ingest_published_slugs_kind_slug_pk` PRIMARY KEY(`kind`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `ingest_published` ADD CONSTRAINT `ingest_published_record_id_ingest_records_id_fk` FOREIGN KEY (`record_id`) REFERENCES `ingest_records`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_published` ADD CONSTRAINT `ingest_published_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_published_slugs` ADD CONSTRAINT `ingest_published_slugs_published_id_ingest_published_id_fk` FOREIGN KEY (`published_id`) REFERENCES `ingest_published`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_published_slugs_published` ON `ingest_published_slugs` (`published_id`);