CREATE TABLE `ingest_overview_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`overview_id` bigint unsigned NOT NULL,
	`list` varchar(16) NOT NULL,
	`position` smallint NOT NULL,
	`text` varchar(1024) NOT NULL,
	CONSTRAINT `ingest_overview_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_overview_items_pos` UNIQUE(`overview_id`,`list`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ingest_overviews` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`summary` text NOT NULL,
	`mcp_note` text,
	`input_hash` char(64) NOT NULL,
	`provider` varchar(32),
	`model` varchar(64),
	`prompt_version` smallint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`problems` json,
	`generated_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_overviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_overviews_entity` UNIQUE(`source_id`,`kind`,`external_id`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `ingest_overview_items` ADD CONSTRAINT `fk_ingest_overview_items_overview` FOREIGN KEY (`overview_id`) REFERENCES `ingest_overviews`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_overviews` ADD CONSTRAINT `ingest_overviews_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_overviews_status` ON `ingest_overviews` (`status`);