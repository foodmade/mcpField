CREATE TABLE `ingest_generated_steps` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`position` smallint NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`command` varchar(1024),
	`input_hash` char(64) NOT NULL,
	`provider` varchar(32),
	`model` varchar(64),
	`prompt_version` smallint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`problems` json,
	`generated_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_generated_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_generated_steps` UNIQUE(`source_id`,`kind`,`external_id`,`locale`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ingest_generated_texts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`field` varchar(24) NOT NULL,
	`content` text NOT NULL,
	`input_hash` char(64) NOT NULL,
	`provider` varchar(32),
	`model` varchar(64),
	`prompt_version` smallint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`problems` json,
	`generated_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_generated_texts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_generated_texts` UNIQUE(`source_id`,`kind`,`external_id`,`locale`,`field`)
);
--> statement-breakpoint
ALTER TABLE `ingest_generated_steps` ADD CONSTRAINT `ingest_generated_steps_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_generated_texts` ADD CONSTRAINT `ingest_generated_texts_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ingest_generated_texts_field` ON `ingest_generated_texts` (`kind`,`field`);